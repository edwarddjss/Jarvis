import { AudioPlayer, createAudioResource, StreamType } from '@discordjs/voice';
import { PassThrough } from 'stream';
import WebSocket from 'ws';
import { logger } from '../../config/index.js';
import { AudioUtils } from '../../utils/index.js';
import type { 
  AgentResponseEvent, 
  AudioEvent, 
  UserTranscriptEvent,
  ConversationInitiationMetadata,
  ElevenLabsEvent
} from './types.js';

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
  private isListening: boolean;
  private currentConversationId: string | null;
  private lastTranscriptTime: number;
  private readonly TRANSCRIPT_TIMEOUT = 5000; // 5 seconds timeout for transcripts

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
    this.isListening = false;
    this.currentConversationId = null;
    this.lastTranscriptTime = 0;
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
   * Disconnects from the ElevenLabs WebSocket.
   * @returns {void}
   */
  public disconnect(): void {
    // Clean up WebSocket
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = null;
    }

    // Clean up audio resources
    this.cleanup();
  }

  /**
   * Appends input audio to the WebSocket.
   * @param {Buffer} buffer - The audio buffer to append.
   * @returns {void}
   */
  appendInputAudio(buffer: Buffer): void {
    if (buffer.byteLength === 0 || this.socket?.readyState !== WebSocket.OPEN) return;

    // Start listening mode if not already started
    if (!this.isListening) {
      this.isListening = true;
      this.lastTranscriptTime = Date.now();
    }

    const base64Audio = {
      user_audio_chunk: buffer.toString('base64'),
    };
    this.socket?.send(JSON.stringify(base64Audio));

    // Check for transcript timeout
    const now = Date.now();
    if (now - this.lastTranscriptTime > this.TRANSCRIPT_TIMEOUT) {
      logger.debug('No transcript received for a while, resetting conversation state');
      this.isListening = false;
      this.lastTranscriptTime = now;
    }
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
      
      // Handle stream errors
      this.currentAudioStream.on('error', (error) => {
        logger.error('Audio stream error:', error);
        this.cleanup();
      });

      // Handle stream end
      this.currentAudioStream.on('end', () => {
        logger.debug('Audio stream ended');
        this.cleanup();
      });

      const resource = createAudioResource(this.currentAudioStream, {
        inputType: StreamType.Raw,
      });

      // Handle audio player errors
      this.audioPlayer.on('error', (error) => {
        logger.error('Audio player error:', error);
        this.cleanup();
      });

      this.audioPlayer.play(resource);
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

    try {
      while (this.audioBufferQueue.length > 0) {
        const audioBuffer = this.audioBufferQueue.shift();
        
        if (!audioBuffer) {
          logger.error('Encountered undefined or null audio buffer');
          continue;
        }

        try {
          this.initializeAudioStream();
          
          const pcmBuffer = await AudioUtils.mono441kHzToStereo48kHz(audioBuffer);
          
          if (!pcmBuffer || pcmBuffer.length === 0) {
            logger.error('Audio conversion failed or resulted in empty buffer');
            continue;
          }

          if (this.currentAudioStream && !this.currentAudioStream.destroyed) {
            const writeResult = this.currentAudioStream.write(pcmBuffer);
            if (!writeResult) {
              // Wait for drain event if buffer is full
              await new Promise(resolve => this.currentAudioStream!.once('drain', resolve));
            }
          }

        } catch (error) {
          logger.error('Error processing audio buffer:', error);
          // Continue with next buffer instead of breaking the entire queue
          continue;
        }
      }
    } finally {
      this.isProcessing = false;
    }
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
   * Handles the agent response event.
   * @param {AgentResponseEvent} event - The agent response event.
   * @returns {void}
   */
  private handleAgentResponse(event: AgentResponseEvent): void {
    const response = event.agent_response_event.agent_response;
    logger.info('Agent Response:', response);

    // Reset listening state after agent responds
    this.isListening = false;
  }

  /**
   * Handles the user transcript event.
   * @param {UserTranscriptEvent} event - The user transcript event.
   * @returns {void}
   */
  private handleUserTranscript(event: UserTranscriptEvent): void {
    const transcript = event.user_transcription_event.user_transcript;
    logger.info('User Transcript:', transcript);
    
    // Update last transcript time
    this.lastTranscriptTime = Date.now();
  }

  /**
   * Handles conversation initiation metadata.
   * @param {ConversationInitiationMetadata} event - The metadata event.
   * @returns {void}
   */
  private handleConversationMetadata(event: ConversationInitiationMetadata): void {
    this.currentConversationId = event.conversation_initiation_metadata_event.conversation_id;
    logger.info('Conversation started with ID:', this.currentConversationId);
  }

  /**
   * Handles events received from the WebSocket.
   * @param {WebSocket.RawData} message - The raw data message.
   * @returns {void}
   */
  private handleEvent(message: WebSocket.RawData): void {
    try {
      const event = JSON.parse(message.toString()) as ElevenLabsEvent;

      switch (event.type) {
        case 'conversation_initiation_metadata':
          this.handleConversationMetadata(event);
          break;
        case 'agent_response':
          this.handleAgentResponse(event);
          break;
        case 'user_transcript':
          this.handleUserTranscript(event);
          break;
        case 'audio':
          this.handleAudio(event).catch(error => {
            logger.error('Error handling audio event:', error);
          });
          break;
        case 'interruption':
          this.handleInterruption();
          break;
        default:
          logger.warn('Unknown event type:', event.type);
      }
    } catch (error) {
      logger.error('Error parsing WebSocket message:', error);
    }
  }

  /**
   * Cleans up resources and resets conversation state.
   * @private
   */
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

    // Clear the audio buffer queue
    this.audioBufferQueue = [];
    this.isProcessing = false;
    this.isListening = false;
    this.currentConversationId = null;
  }
}