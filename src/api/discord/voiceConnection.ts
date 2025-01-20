import { 
    getVoiceConnection, 
    joinVoiceChannel, 
    VoiceConnection,
    VoiceConnectionStatus,
    entersState,
    AudioReceiveStream
  } from '@discordjs/voice';
  import { CommandInteraction, GuildMember } from 'discord.js';
  import { logger } from '../../config/index.js';
  import { Embeds } from '../../utils/index.js';
  import { ElevenLabsConversationalAI } from '../elevenlabs/conversationalClient.js';
  import { VoiceStateManager, VoiceActivityType } from './voiceStateManager.js';

/**
 * Manages voice connections for a Discord bot, handling connection and disconnection from voice channels.
 * Includes sophisticated voice activity detection and audio processing.
 *
 * @class VoiceConnectionHandler
 * @property {CommandInteraction} interaction - The Discord command interaction instance
 * @property {VoiceConnection | null} connection - The current voice connection, if any
 */
class VoiceConnectionHandler {
    private interaction: CommandInteraction;
    private isSpeaking: boolean = false;
    private silenceTimer: NodeJS.Timeout | null = null;
    private audioLevel: number = 0;
    private readonly SILENCE_THRESHOLD = 500; // ms to wait before considering speech ended
    private readonly NOISE_THRESHOLD = -50; // dB threshold for noise
    private readonly SPEECH_THRESHOLD = -35; // dB threshold for speech
    private consecutiveNoiseFrames: number = 0;
    private readonly REQUIRED_NOISE_FRAMES = 3; // Number of consecutive frames needed to confirm speech
    private currentConnection: VoiceConnection | null = null;
    private readonly isMusic: boolean;
    private stateManager: VoiceStateManager;

    /**
     * Creates an instance of VoiceConnectionHandler.
     * @param {CommandInteraction} interaction - The command interaction from Discord.
     * @param {boolean} isMusic - Whether this connection is for music playback
     */
    constructor(interaction: CommandInteraction, isMusic: boolean = false) {
        this.interaction = interaction;
        this.isMusic = isMusic;
        this.stateManager = VoiceStateManager.getInstance();
    }

    /**
     * Attempts to connect the bot to the voice channel of the user who invoked the command.
     * Sets up voice activity detection and audio processing.
     *
     * @async
     * @returns {Promise<VoiceConnection | void>} The voice connection if successful, void if connection fails
     * @throws Will throw an error if connection fails unexpectedly
     */
    async connect(): Promise<VoiceConnection | void> {
        try {
            if (!this.isUserInVoiceChannel()) {
                return;
            }

            const existingConnection = getVoiceConnection(this.interaction.guildId!);
            if (existingConnection) {
                return;
            }

            const member = this.interaction.member as GuildMember;
            const connection = joinVoiceChannel({
                channelId: member.voice.channel!.id,
                guildId: this.interaction.guildId!,
                adapterCreator: member.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false,
            });

            try {
                // Wait for the connection to be ready
                await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
                this.currentConnection = connection;
                this.setupConnectionHandlers(connection);

                // Set appropriate voice state
                const voiceState = this.isMusic ? VoiceActivityType.MUSIC : VoiceActivityType.SPEECH;
                this.stateManager.setVoiceState(this.interaction.guildId!, voiceState);
  
                return connection;
            } catch (error) {
                connection.destroy();
                throw error;
            }

        } catch (error) {
            logger.error(error, 'Error connecting to voice channel');
        }
    }

    /**
     * Sets up handlers for voice connection events and audio processing.
     * @private
     * @param {VoiceConnection} connection - The voice connection to set up handlers for
     */
    private setupConnectionHandlers(connection: VoiceConnection) {
        connection.receiver.speaking.on('start', (userId) => {
            this.handleAudioStart(userId);
        });

        connection.receiver.speaking.on('end', (userId) => {
            this.handleAudioEnd(userId);
        });

        // Handle connection state changes
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

        // Subscribe to audio streams
        connection.receiver.speaking.on('start', (userId) => {
            const audioStream = connection.receiver.subscribe(userId);
            this.handleAudioStream(audioStream);
        });
    }

    /**
     * Processes audio stream data to detect genuine speech.
     * @private
     * @param {AudioReceiveStream} audioStream - The audio stream to process
     */
    private handleAudioStream(audioStream: AudioReceiveStream) {
        audioStream.on('data', (chunk: Buffer) => {
            const audioLevel = this.calculateAudioLevel(chunk);
            this.processAudioLevel(audioLevel);
        });

        audioStream.on('end', () => {
            logger.debug('Audio stream ended');
        });
    }

    /**
     * Processes audio levels to determine if genuine speech is occurring.
     * @private
     * @param {number} audioLevel - The calculated audio level in dB
     */
    private processAudioLevel(audioLevel: number) {
        if (audioLevel > this.NOISE_THRESHOLD) {
            this.consecutiveNoiseFrames++;

            if (audioLevel > this.SPEECH_THRESHOLD && 
                this.consecutiveNoiseFrames >= this.REQUIRED_NOISE_FRAMES) {
                if (!this.isSpeaking) {
                    this.handleSpeechStart();
                }
                if (this.silenceTimer) {
                    clearTimeout(this.silenceTimer);
                    this.silenceTimer = null;
                }
            }
        } else {
            this.consecutiveNoiseFrames = 0;
            if (this.isSpeaking && !this.silenceTimer) {
                this.silenceTimer = setTimeout(() => {
                    this.handleSpeechEnd();
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
     * Handles initial audio detection.
     * @private
     * @param {string} userId - The ID of the user who started speaking
     */
    private handleAudioStart(userId: string) {
        logger.debug(`Audio started from user: ${userId}`);
    }

    /**
     * Handles audio stream end.
     * @private
     * @param {string} userId - The ID of the user who stopped speaking
     */
    private handleAudioEnd(userId: string) {
        logger.debug(`Audio ended from user: ${userId}`);
    }

    /**
     * Validates that the user who invoked the command is in a voice channel.
     * @private
     * @returns {boolean} True if the member is in a voice channel, false otherwise
     */
    private isUserInVoiceChannel(): boolean {
        return !!(this.interaction.member instanceof GuildMember && this.interaction.member.voice.channel);
    }

    /**
     * Disconnects the bot from the current voice channel.
     * @async
     * @returns {Promise<boolean>} True if successfully disconnected, false otherwise
     */
    async disconnect(): Promise<boolean> {
        try {
            if (this.currentConnection) {
                this.currentConnection.destroy();
                this.currentConnection = null;
                // Clear voice state on disconnect
                this.stateManager.clearState(this.interaction.guildId!);
                return true;
            }
            return false;
        } catch (error) {
            logger.error(error, 'Error disconnecting from voice channel');
            return false;
        }
    }

    /**
     * Emits events for the ConversationalClient to handle.
     * @private
     * @param {string} event - The name of the event to emit
     */
    private emit(event: string) {
        logger.info(`Emitting event: ${event}`);
        // Implement your event emission logic here
    }

    /**
     * Checks if the bot is currently detecting speech.
     * @returns {boolean} True if speech is currently detected
     */
    public isCurrentlySpeaking(): boolean {
        return this.isSpeaking;
    }
}

export { VoiceConnectionHandler };