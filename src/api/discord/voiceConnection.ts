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
                      content: '❌ You must be in a voice channel to use this command!',
                      ephemeral: true
                  });
              }
              return null;
          }

          const existingConnection = getVoiceConnection(this.interaction.guildId!);
          if (existingConnection) {
              if (!this.interaction.replied && !this.interaction.deferred) {
                  await this.interaction.reply({
                      content: '❌ Bot is already in a voice channel.',
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
              selfDeaf: this.isForMusic, // Only deaf for music mode
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
                      content: message,
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
                  content: '❌ An error occurred while connecting to the voice channel.',
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
      // Subscribe the audio player to the voice connection
      connection.subscribe(this.audioPlayer);

      // For music, we want to be deaf (don't receive audio)
      connection.receiver.speaking.removeAllListeners();

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
      // For speech, we need to subscribe the audio player for bot responses
      connection.subscribe(this.audioPlayer);

      // Initialize ElevenLabs client immediately for speech mode
      if (!this.conversationalAI) {
          this.conversationalAI = new ElevenLabsConversationalAI(this.audioPlayer);
          this.conversationalAI.connect().catch(error => {
              logger.error('Failed to connect to ElevenLabs:', error);
          });
      }

      // Clean up any existing subscriptions and set up speech detection
      connection.receiver.speaking.removeAllListeners();

      connection.receiver.speaking.on('start', (userId) => {
          // Only handle speech if we're not playing music
          if (!this.isForMusic && this.conversationalAI) {
              const audioStream = connection.receiver.subscribe(userId);
              audioStream.setMaxListeners(20);
              this.handleAudioStream(audioStream);
          }
      });

      connection.receiver.speaking.on('end', (userId) => {
          if (!this.isForMusic) {
              this.handleAudioEnd(userId);
          }
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
              await Promise.race([
                  entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                  entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
              ]);
          } catch (error) {
              this.cleanup();
              connection.destroy();
              this.currentConnection = null;
          }
      });

      connection.on(VoiceConnectionStatus.Destroyed, () => {
          this.cleanup();
          this.currentConnection = null;
      });
  }

  /**
   * Processes audio stream data to detect genuine speech.
   * @private
   * @param {AudioReceiveStream} audioStream - The audio stream to process
   */
  private handleAudioStream(audioStream: AudioReceiveStream) {
      // Skip if in music mode
      if (this.isForMusic) {
          return;
      }

      // Remove any existing listeners before adding new ones
      audioStream.removeAllListeners();

      audioStream.on('data', (chunk: Buffer) => {
          // Double check we're still in speech mode
          if (!this.isForMusic && this.conversationalAI) {
              const audioLevel = this.calculateAudioLevel(chunk);
              this.processAudioLevel(audioLevel);
              
              // Only send audio to ElevenLabs if we're speaking
              if (this.isSpeaking) {
                  this.conversationalAI.appendInputAudio(chunk);
              }
          }
      });

      audioStream.on('end', () => {
          logger.debug('Audio stream ended');
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

      // Skip processing if in music mode
      if (this.isForMusic) {
          return;
      }

      // Always update consecutive frames count based on audio level
      if (audioLevel > this.NOISE_THRESHOLD) {
          this.consecutiveNoiseFrames++;
      } else {
          // More gradual decrease to prevent quick toggling
          this.consecutiveNoiseFrames = Math.max(0, this.consecutiveNoiseFrames - 0.5);
      }

      // Handle potential speech start
      if (!this.isSpeaking && 
          audioLevel > this.SPEECH_THRESHOLD && 
          this.consecutiveNoiseFrames >= this.REQUIRED_NOISE_FRAMES &&
          timeSinceLastEvent >= this.MIN_EVENT_INTERVAL) {
          
          // Double check we're not in music mode
          if (!this.isForMusic && this.conversationalAI) {
              this.handleSpeechStart();
              this.lastSpeechEvent = now;
          }
          return;
      }

      // Handle ongoing speech and potential end
      if (this.isSpeaking) {
          if (audioLevel > this.NOISE_THRESHOLD) {
              // Clear silence timer if there's noise
              if (this.silenceTimer) {
                  clearTimeout(this.silenceTimer);
                  this.silenceTimer = null;
              }
          } else if (!this.silenceTimer && timeSinceLastEvent >= this.MIN_EVENT_INTERVAL) {
              // Start silence timer only if we've waited long enough since last event
              this.silenceTimer = setTimeout(() => {
                  // Double check we're still in speech mode
                  if (!this.isForMusic && this.isSpeaking) {
                      this.handleSpeechEnd();
                      this.lastSpeechEvent = Date.now();
                      this.consecutiveNoiseFrames = 0;
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

      // Stop audio player
      if (this.audioPlayer) {
          this.audioPlayer.stop();
      }

      // Clean up ElevenLabs client
      if (this.conversationalAI) {
          this.conversationalAI.disconnect();
          this.conversationalAI = null;
      }

      // Reset all state
      this.audioBufferQueue = [];
      this.isProcessing = false;
      this.isSpeaking = false;
      this.consecutiveNoiseFrames = 0;
      if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
      }

      // Remove all event listeners
      this.removeAllListeners();
  }
}

export { VoiceConnectionHandler };