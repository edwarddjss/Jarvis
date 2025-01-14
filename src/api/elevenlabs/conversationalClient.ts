import { AudioPlayer, createAudioResource, StreamType } from '@discordjs/voice';
import { PassThrough } from 'stream';
import WebSocket from 'ws';
import { logger } from '../../config/index.js';
import { AudioUtils } from '../../utils/index.js';
import type { AgentResponseEvent, AudioEvent, UserTranscriptEvent } from './types.js';

/**
 * Manages the ElevenLabs Conversational AI WebSocket.
 */
export class ElevenLabsConversationalAI {
  private url: string;
  private socket: WebSocket | null;
  private audioPlayer: AudioPlayer;
  private currentAudioStream: PassThrough | null;
  private audioBufferQueue: Buffer[];
  private isProcessing: boolean;

  /**
   * Creates an instance of ElevenLabsConversationalAI.
   * @param {AudioPlayer} audioPlayer - The audio player instance.
   */
  constructor(audioPlayer: AudioPlayer) {
    // Ensure the agent ID is not an empty string
    if (!process.env.AGENT_ID) {
      throw new Error('AGENT_ID is not set');
    }

    // Increase max listeners to prevent warnings
    audioPlayer.setMaxListeners(20);

    this.url = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${process.env.AGENT_ID}`;
    this.audioPlayer = audioPlayer;
    this.socket = null;
    this.currentAudioStream = null;
    this.audioBufferQueue = [];
    this.isProcessing = false;
  }

  /**
   * Connects to the ElevenLabs WebSocket.
   * @returns {Promise<void>} A promise that resolves when the connection is established.
   */
  public async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      logger.info('Establishing connection to ElevenLabs Conversational WebSocket...');
      this.socket = new WebSocket(this.url);

      this.socket.on('open', () => {
        logger.info('Successfully connected to ElevenLabs Conversational WebSocket.');
        resolve();
      });

      this.socket.on('error', error => {
        logger.error(error, 'WebSocket encountered an error');
        reject(new Error(`Error during WebSocket connection: ${error.message}`));
      });

      this.socket.on('close', (code: number, reason: string) => {
        logger.info(`ElevenLabs WebSocket closed with code ${code}. Reason: ${reason}`);
        this.cleanup();
      });

      this.socket.on('message', message => this.handleEvent(message));
    });
  }

  /**
   * Cleans up the current audio stream if it exists.
   * @private
   */
  private cleanup(): void {
    if (this.currentAudioStream && !this.currentAudioStream.destroyed) {
      this.currentAudioStream.push(null);
      this.currentAudioStream.destroy();
      this.currentAudioStream = null;
    }
  }

  /**
   * Disconnects from the ElevenLabs WebSocket.
   * @returns {void}
   */
  public disconnect(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.cleanup();
  }

  /**
   * Appends input audio to the WebSocket.
   * @param {Buffer} buffer - The audio buffer to append.
   * @returns {void}
   */
  appendInputAudio(buffer: Buffer): void {
    if (buffer.byteLength === 0 || this.socket?.readyState !== WebSocket.OPEN) return;

    const base64Audio = {
      user_audio_chunk: buffer.toString('base64'),
    };
    this.socket?.send(JSON.stringify(base64Audio));
  }

  /**
   * Handles an interruption during the conversation.
   * @private
   * @returns {void}
   */
  private handleInterruption(): void {
    this.audioPlayer.stop();
    logger.info('Conversation interrupted.');
  }

  /**
   * Initializes the audio stream for playback.
   * @private
   * @returns {void}
   */
  private initializeAudioStream(): void {
    if (!this.currentAudioStream || this.currentAudioStream.destroyed) {
      this.currentAudioStream = new PassThrough();
      this.audioPlayer.play(
        createAudioResource(this.currentAudioStream, {
          inputType: StreamType.Raw,
        })
      );
    }
  }

  /**
   * Processes the audio buffer queue and writes audio to the current audio stream.
   * @private
   * @returns {Promise<void>} A promise that resolves when the processing is complete.
   */
  private async processAudioQueue(): Promise<void> {
    if (this.isProcessing || this.audioBufferQueue.length === 0) return;

    this.isProcessing = true;

    while (this.audioBufferQueue.length > 0) {
      const audioBuffer = this.audioBufferQueue.shift();
      
      logger.info(`Processing audio buffer. Queue size: ${this.audioBufferQueue.length}`);
      
      if (!audioBuffer) {
        logger.error('Encountered undefined or null audio buffer');
        continue;
      }

      try {
        logger.info(`Buffer details - Length: ${audioBuffer.length}, Type: ${typeof audioBuffer}`);

        this.initializeAudioStream();
        
        let pcmBuffer;
        try {
          pcmBuffer = await AudioUtils.mono441kHzToStereo48kHz(audioBuffer);
        } catch (conversionError) {
          logger.error('FFmpeg conversion error:', {
            errorMessage: conversionError instanceof Error ? conversionError.message : 'Unknown error',
            errorStack: conversionError instanceof Error ? conversionError.stack : 'No stack trace',
            bufferLength: audioBuffer.length,
            bufferType: typeof audioBuffer,
            bufferData: audioBuffer.toString('base64').slice(0, 100) // First 100 chars of base64 for context
          });
          continue;
        }
        
        if (!pcmBuffer) {
          logger.error('Conversion resulted in null buffer');
          continue;
        }

        if (pcmBuffer.length === 0) {
          logger.error('Conversion resulted in empty buffer');
          continue;
        }

        try {
          const writeResult = this.currentAudioStream?.write(pcmBuffer);
          if (writeResult === false) {
            logger.error('Failed to write audio buffer to stream');
          }
        } catch (writeError) {
          logger.error('Error writing audio buffer:', writeError);
        }

      } catch (error) {
        logger.error('Unexpected error in audio processing:', {
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          errorStack: error instanceof Error ? error.stack : 'No stack trace',
          bufferLength: audioBuffer.length,
        });
      }
    }

    this.isProcessing = false;
  }

  /**
   * Handles the audio event received from the WebSocket.
   * @param {AudioEvent} message - The audio event message containing audio data.
   * @returns {Promise<void>} A promise that resolves when the audio is processed.
   */
  private async handleAudio(message: AudioEvent): Promise<void> {
    const audioBuffer = Buffer.from(message.audio_event.audio_base_64, 'base64');
    this.audioBufferQueue.push(audioBuffer);
    await this.processAudioQueue();
  }

  /**
   * Handles events received from the WebSocket.
   * @param {WebSocket.RawData} message - The raw data message.
   * @returns {void}
   */
  private handleEvent(message: WebSocket.RawData): void {
    const event = JSON.parse(message.toString());

    switch (event.type) {
      case 'agent_response':
        this.handleAgentResponse(event);
        break;
      case 'user_transcript':
        this.handleUserTranscript(event);
        break;
      case 'audio':
        this.handleAudio(event);
        break;
      case 'interruption':
        this.handleInterruption();
        break;
    }
  }

  /**
   * Handles the agent response event.
   * @param {AgentResponseEvent} event - The agent response event.
   * @returns {void}
   */
  private handleAgentResponse(event: AgentResponseEvent): void {
    logger.info(event);
  }

  /**
   * Handles the user transcript event.
   * @param {UserTranscriptEvent} event - The user transcript event.
   * @returns {void}
   */
  private handleUserTranscript(event: UserTranscriptEvent): void {
    logger.info(event);
  }
}