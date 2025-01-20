import opus from '@discordjs/opus';
import { AudioReceiveStream, EndBehaviorType, VoiceConnection } from '@discordjs/voice';
import { logger } from '../../config/index.js';
import { ElevenLabsConversationalAI } from '../index.js';
import { spawn } from 'child_process';

/**
 * Handles speech processing for users in a voice channel.
 */
class SpeechHandler {
  private speakingUsers: Map<string, AudioReceiveStream>;
  private client: ElevenLabsConversationalAI;
  private connection: VoiceConnection;
  private isProcessing: boolean = false;
  private readonly TARGET_SAMPLE_RATE = 16000; // ElevenLabs input format

  constructor(
    client: ElevenLabsConversationalAI,
    connection: VoiceConnection
  ) {
    this.speakingUsers = new Map();
    this.client = client;
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
            existingStream.removeAllListeners();
            existingStream.destroy();
            this.speakingUsers.delete(userId);
          }
        }

        const audioStream = this.connection.receiver.subscribe(userId, {
          end: { behavior: EndBehaviorType.AfterSilence, duration: 500 }
        });

        // Set max listeners to prevent memory leak warning
        audioStream.setMaxListeners(20);

        // Set up stream event handlers with proper cleanup
        const dataHandler = this.handleAudioData.bind(this);
        audioStream.on('data', dataHandler);

        const endHandler = () => {
          audioStream.removeListener('data', dataHandler);
          audioStream.removeAllListeners('end');
          audioStream.destroy();
          this.speakingUsers.delete(userId);
          logger.debug(`Audio stream ended for user: ${userId}`);
        };

        audioStream.once('end', endHandler);
        this.speakingUsers.set(userId, audioStream);
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
  private async handleAudioData(chunk: Buffer): Promise<void> {
    if (this.isProcessing) return;

    try {
      this.isProcessing = true;
      
      // Convert opus to PCM and resample to 16kHz
      const converted = await this.convertAudio(chunk);
      if (converted) {
        this.client.appendInputAudio(converted);
      }
    } catch (error) {
      logger.error(error, 'Error processing audio for transcription');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Converts opus audio to PCM with correct sample rate.
   * @returns Promise<Buffer | null> The converted audio buffer or null if conversion fails
   */
  private async convertAudio(opusChunk: Buffer): Promise<Buffer | null> {
    try {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',        // Input format
        '-ar', '48000',       // Input sample rate (Discord's opus decoder rate)
        '-ac', '2',           // Input channels (Discord's opus decoder channels)
        '-i', 'pipe:0',       // Input from stdin
        '-f', 's16le',        // Output format
        '-ar', this.TARGET_SAMPLE_RATE.toString(), // Output sample rate for ElevenLabs
        '-ac', '1',           // Output mono audio
        '-acodec', 'pcm_s16le', // Output codec
        'pipe:1'              // Output to stdout
      ]);

      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        
        ffmpeg.stdout.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        ffmpeg.stderr.on('data', (data: Buffer) => {
          logger.debug(`FFmpeg: ${data.toString()}`);
        });

        ffmpeg.on('close', (code: number) => {
          if (code === 0 && chunks.length > 0) {
            resolve(Buffer.concat(chunks));
          } else {
            reject(new Error(`FFmpeg process exited with code ${code}`));
          }
        });

        ffmpeg.stdin.write(opusChunk);
        ffmpeg.stdin.end();
      });

    } catch (error) {
      logger.error('Error converting audio:', error);
      return null;
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
