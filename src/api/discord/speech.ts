import opus from '@discordjs/opus';
import { AudioReceiveStream, EndBehaviorType, VoiceConnection } from '@discordjs/voice';
import { logger } from '../../config/index.js';
import { ElevenLabsConversationalAI } from '../index.js';

/**
 * Handles speech processing for users in a voice channel.
 */
class SpeechHandler {
  private speakingUsers: Map<string, AudioReceiveStream>;
  private client: ElevenLabsConversationalAI;
  private decoder: opus.OpusEncoder;
  private connection: VoiceConnection;
  private isProcessing: boolean = false;

  constructor(
    client: ElevenLabsConversationalAI,
    connection: VoiceConnection,
    sampleRate: number = 16000,
    channels: number = 1
  ) {
    this.speakingUsers = new Map();
    this.client = client;
    this.decoder = new opus.OpusEncoder(sampleRate, channels);
    this.connection = connection;
  }

  /**
   * Initializes the speech handler and sets up event listeners.
   */
  async initialize(): Promise<void> {
    try {
      await this.client.connect();

      // Remove any existing listeners
      this.connection.receiver.speaking.removeAllListeners();

      // Set up speaking event handler
      this.connection.receiver.speaking.on('start', (userId: string) => {
        if (this.speakingUsers.has(userId)) {
          // Clean up existing stream if it exists
          const existingStream = this.speakingUsers.get(userId);
          if (existingStream) {
            existingStream.destroy();
            this.speakingUsers.delete(userId);
          }
        }

        const audioStream = this.connection.receiver.subscribe(userId, {
          end: { behavior: EndBehaviorType.AfterSilence, duration: 500 }
        });

        this.speakingUsers.set(userId, audioStream);

        // Set up stream event handlers
        audioStream.on('data', this.handleAudioData.bind(this));
        audioStream.once('end', () => {
          audioStream.removeAllListeners();
          this.speakingUsers.delete(userId);
          logger.debug(`Audio stream ended for user: ${userId}`);
        });
      });

      // Handle connection state changes
      this.connection.on('stateChange', (_, newState) => {
        if (newState.status === 'disconnected' || newState.status === 'destroyed') {
          this.cleanup();
        }
      });

    } catch (error) {
      logger.error(error, 'Error initializing speech handler');
      throw error;
    }
  }

  /**
   * Handles incoming audio data.
   */
  private handleAudioData(chunk: Buffer): void {
    if (this.isProcessing) return;

    try {
      this.isProcessing = true;
      const pcmBuffer = this.decoder.decode(chunk);
      this.client.appendInputAudio(pcmBuffer);
    } catch (error) {
      logger.error(error, 'Error processing audio for transcription');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Cleans up audio streams and disconnects the client.
   */
  public cleanup(): void {
    // Clean up all audio streams
    for (const [userId, stream] of this.speakingUsers) {
      stream.removeAllListeners();
      stream.destroy();
      this.speakingUsers.delete(userId);
    }

    // Remove all connection listeners
    this.connection.receiver.speaking.removeAllListeners();
    this.connection.removeAllListeners();

    // Disconnect the client
    this.client.disconnect();
  }
}

export { SpeechHandler };
