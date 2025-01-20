import { 
  joinVoiceChannel, 
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
  AudioReceiveStream,
  DiscordGatewayAdapterCreator,
  getVoiceConnection,
  createAudioPlayer,
  AudioPlayer,
  NoSubscriberBehavior
} from '@discordjs/voice';
import { PassThrough } from 'stream';
import { CommandInteraction, GuildMember } from 'discord.js';
import { logger } from '../../config/index.js';
import { Embeds } from '../../utils/index.js';
import { ElevenLabsConversationalAI } from '../elevenlabs/conversationalClient.js';
import { EventEmitter } from 'events';

/**
* Manages voice connections for a Discord bot, handling connection and disconnection from voice channels.
* Includes sophisticated voice activity detection and audio processing.
*
* @class VoiceConnectionHandler
* @extends EventEmitter
* @property {CommandInteraction} interaction - The Discord command interaction instance
* @property {VoiceConnection | null} connection - The current voice connection, if any
*/
class VoiceConnectionHandler extends EventEmitter {
  private interaction: CommandInteraction;
  private isSpeaking: boolean = false;
  private silenceTimer: NodeJS.Timeout | null = null;
  private audioLevel: number = 0;
  private readonly SILENCE_THRESHOLD = 1000; // Increased from 500ms to 1000ms
  private readonly NOISE_THRESHOLD = -45; // Increased from -50 to -45 dB
  private readonly SPEECH_THRESHOLD = -30; // Increased from -35 to -30 dB
  private consecutiveNoiseFrames: number = 0;
  private readonly REQUIRED_NOISE_FRAMES = 5; // Increased from 3 to 5 frames
  private currentConnection: VoiceConnection | null = null;
  private isForMusic: boolean = false;
  private conversationalAI: ElevenLabsConversationalAI | null = null;
  private currentAudioStream: PassThrough | null = null;
  private audioBufferQueue: Buffer[] = [];
  private isProcessing: boolean = false;
  private audioPlayer: AudioPlayer;
  private lastSpeechEvent: number = 0;
  private readonly MIN_EVENT_INTERVAL = 500; // Minimum time between speech events in ms

  /**
   * Creates an instance of VoiceConnectionHandler.
   * @param {CommandInteraction} interaction - The command interaction from Discord.
   * @param {boolean} isForMusic - Whether this connection is for music playback
   */
  constructor(interaction: CommandInteraction, isForMusic: boolean = false) {
      super();
      this.interaction = interaction;
      this.isForMusic = isForMusic;
      this.audioPlayer = createAudioPlayer({
          behaviors: {
              noSubscriber: NoSubscriberBehavior.Play
          }
      });
      
      // Set higher limit for listeners
      this.audioPlayer.setMaxListeners(20);
  }

  /**
   * Attempts to connect the bot to the voice channel of the user who invoked the command.
   * Sets up voice activity detection and audio processing.
   *
   * @async
   * @returns {Promise<VoiceConnection | null>} The voice connection if successful, null if connection fails
   * @throws Will throw an error if connection fails unexpectedly
   */
  async connect(): Promise<VoiceConnection | null> {
      try {
          if (!this.isUserInVoiceChannel()) {
              if (!this.interaction.replied && !this.interaction.deferred) {
                  await this.interaction.reply({
                      embeds: [Embeds.error('Error', 'You need to be in a voice channel to use this command.')],
                      ephemeral: true
                  });
              }
              return null;
          }

          const existingConnection = getVoiceConnection(this.interaction.guildId!);
          if (existingConnection) {
              if (!this.interaction.replied && !this.interaction.deferred) {
                  await this.interaction.reply({
                      embeds: [Embeds.error('Error', 'Bot is already in a voice channel.')],
                      ephemeral: true
                  });
              }
              return null;
          }

          const member = this.interaction.member as GuildMember;
          const connection = joinVoiceChannel({
              channelId: member.voice.channel!.id,
              guildId: this.interaction.guildId!,
              adapterCreator: member.guild.voiceAdapterCreator,
              selfDeaf: this.isForMusic, // Deaf for music, not deaf for speech
              selfMute: false,
          });

          try {
              await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
              this.currentConnection = connection;
              
              if (this.isForMusic) {
                  this.setupMusicConnectionHandlers(connection);
              } else {
                  this.setupSpeechConnectionHandlers(connection);
              }

              if (!this.interaction.replied && !this.interaction.deferred) {
                  const message = this.isForMusic ? '🎵 Ready to play music!' : "Let's chat!";
                  await this.interaction.reply({
                      embeds: [Embeds.success('Connected', message)],
                      ephemeral: true
                  });
              }
              return connection;
          } catch (error) {
              connection.destroy();
              throw error;
          }
      } catch (error) {
          logger.error(error, 'Error connecting to voice channel');
          if (!this.interaction.replied && !this.interaction.deferred) {
              await this.interaction.reply({
                  embeds: [Embeds.error('Error', 'An error occurred while connecting to the voice channel.')],
                  ephemeral: true
              });
          }
          return null;
      }
  }

  /**
   * Validates that the user who invoked the command is in a voice channel.
   * @private
   * @returns {boolean} True if the member is in a voice channel, false otherwise
   */
  private isUserInVoiceChannel(): boolean {
      return this.interaction.member instanceof GuildMember && 
             this.interaction.member.voice.channel !== null;
  }

  private setupMusicConnectionHandlers(connection: VoiceConnection) {
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
              await Promise.race([
                  entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                  entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
              ]);
          } catch (error) {
              connection.destroy();
              this.currentConnection = null;
          }
      });

      connection.on(VoiceConnectionStatus.Destroyed, () => {
          this.currentConnection = null;
      });
  }

  private setupSpeechConnectionHandlers(connection: VoiceConnection) {
      // Initialize ElevenLabs client immediately for speech mode
      if (!this.isForMusic && !this.conversationalAI) {
          this.conversationalAI = new ElevenLabsConversationalAI(this.audioPlayer);
          this.conversationalAI.connect().catch(error => {
              logger.error('Failed to connect to ElevenLabs:', error);
          });
      }

      // Clean up any existing subscriptions
      connection.receiver.speaking.removeAllListeners();

      connection.receiver.speaking.on('start', (userId) => {
          const audioStream = connection.receiver.subscribe(userId);
          // Set higher limit for listeners
          audioStream.setMaxListeners(20);
          this.handleAudioStream(audioStream);
      });

      connection.receiver.speaking.on('end', (userId) => {
          this.handleAudioEnd(userId);
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
              await Promise.race([
                  entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                  entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
              ]);
          } catch (error) {
              connection.destroy();
              this.currentConnection = null;
          }
      });

      connection.on(VoiceConnectionStatus.Destroyed, () => {
          this.currentConnection = null;
          // Clean up ElevenLabs client when connection is destroyed
          if (this.conversationalAI) {
              this.conversationalAI.disconnect();
              this.conversationalAI = null;
          }
      });
  }

  /**
   * Processes audio stream data to detect genuine speech.
   * @private
   * @param {AudioReceiveStream} audioStream - The audio stream to process
   */
  private handleAudioStream(audioStream: AudioReceiveStream) {
      // Remove any existing listeners before adding new ones
      audioStream.removeAllListeners();

      audioStream.on('data', (chunk: Buffer) => {
          const audioLevel = this.calculateAudioLevel(chunk);
          this.processAudioLevel(audioLevel);
          
          // Send audio data to ElevenLabs if we're in speech mode
          if (!this.isForMusic && this.isSpeaking && this.conversationalAI) {
              this.conversationalAI.appendInputAudio(chunk);
          }
      });

      audioStream.on('end', () => {
          logger.debug('Audio stream ended');
          // Clean up listeners when stream ends
          audioStream.removeAllListeners();
      });
  }

  /**
   * Processes audio levels to determine if genuine speech is occurring.
   * @private
   * @param {number} audioLevel - The calculated audio level in dB
   */
  private processAudioLevel(audioLevel: number) {
      const now = Date.now();
      const timeSinceLastEvent = now - this.lastSpeechEvent;

      // Ignore rapid changes if they occur too soon after the last event
      if (timeSinceLastEvent < this.MIN_EVENT_INTERVAL) {
          return;
      }

      if (audioLevel > this.NOISE_THRESHOLD) {
          this.consecutiveNoiseFrames++;
          
          if (audioLevel > this.SPEECH_THRESHOLD && 
              this.consecutiveNoiseFrames >= this.REQUIRED_NOISE_FRAMES &&
              !this.isSpeaking) {
              this.handleSpeechStart();
              this.lastSpeechEvent = now;
          }

          // Reset silence timer if we're already speaking
          if (this.isSpeaking && this.silenceTimer) {
              clearTimeout(this.silenceTimer);
              this.silenceTimer = null;
          }
      } else {
          this.consecutiveNoiseFrames = Math.max(0, this.consecutiveNoiseFrames - 1); // Gradual decrease
          
          if (this.isSpeaking && !this.silenceTimer) {
              this.silenceTimer = setTimeout(() => {
                  if (timeSinceLastEvent >= this.MIN_EVENT_INTERVAL) {
                      this.handleSpeechEnd();
                      this.lastSpeechEvent = now;
                  }
              }, this.SILENCE_THRESHOLD);
          }
      }
  }

  /**
   * Calculates the audio level from raw audio data.
   * @private
   * @param {Buffer} chunk - The audio data chunk
   * @returns {number} The calculated audio level in dB
   */
  private calculateAudioLevel(chunk: Buffer): number {
      const samples = new Int16Array(chunk.buffer);
      let sum = 0;
      
      for (let i = 0; i < samples.length; i++) {
          sum += samples[i] * samples[i];
      }
      
      const rms = Math.sqrt(sum / samples.length);
      return 20 * Math.log10(rms / 32768); // Convert to dB
  }

  /**
   * Handles the start of detected speech.
   * @private
   */
  private handleSpeechStart() {
      this.isSpeaking = true;
      logger.info('Real speech detected');
      this.emit('realSpeechStart');
  }

  /**
   * Handles the end of detected speech.
   * @private
   */
  private handleSpeechEnd() {
      this.isSpeaking = false;
      this.consecutiveNoiseFrames = 0;
      this.silenceTimer = null;
      logger.info('Speech ended');
      this.emit('realSpeechEnd');
  }

  /**
   * Disconnects the bot from the current voice channel.
   * @async
   * @returns {Promise<boolean>} True if successfully disconnected, false otherwise
   */
  async disconnect(): Promise<boolean> {
      try {
          const connection = getVoiceConnection(this.interaction.guildId!);
          if (!connection) {
              return false;
          }

          connection.destroy();
          this.currentConnection = null;
          return true;
      } catch (error) {
          logger.error(error, 'Error disconnecting from voice channel');
          return false;
      }
  }

  /**
   * Handles audio stream end.
   * @private
   * @param {string} userId - The ID of the user who stopped speaking
   */
  private handleAudioEnd(userId: string): void {
      logger.debug(`Audio ended from user: ${userId}`);
      if (this.isSpeaking) {
          this.handleSpeechEnd();
      }
  }

  /**
   * Emits events for the ConversationalClient to handle.
   * @private
   * @param {string} eventName - The name of the event to emit
   * @param {...any[]} args - Arguments to pass to the event handler
   * @returns {boolean} True if the event had listeners, false otherwise
   */
  override emit(eventName: string | symbol, ...args: any[]): boolean {
      logger.info(`Emitting event: ${String(eventName)}`);
      return super.emit(eventName, ...args);
  }

  /**
   * Checks if the bot is currently detecting speech.
   * @returns {boolean} True if speech is currently detected
   */
  public isCurrentlySpeaking(): boolean {
      return this.isSpeaking;
  }

  private cleanup(): void {
      // Clean up audio stream
      if (this.currentAudioStream && !this.currentAudioStream.destroyed) {
          this.currentAudioStream.removeAllListeners();
          this.currentAudioStream.end();
          this.currentAudioStream.destroy();
          this.currentAudioStream = null;
      }

      // Clean up ElevenLabs client
      if (this.conversationalAI) {
          this.conversationalAI.disconnect();
          this.conversationalAI = null;
      }

      // Stop audio player
      if (this.audioPlayer) {
          this.audioPlayer.stop();
      }

      // Clear the audio buffer queue
      this.audioBufferQueue = [];
      this.isProcessing = false;

      // Remove all event listeners
      this.removeAllListeners();
  }
}

export { VoiceConnectionHandler };