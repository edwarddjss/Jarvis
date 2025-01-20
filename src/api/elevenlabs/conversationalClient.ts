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
      
      // Clean up any existing connection
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.close();
        this.socket = null;
      }

      this.socket = new WebSocket(this.url);

      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        if (this.socket?.readyState !== WebSocket.OPEN) {
          this.socket?.close();
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000); // 10 second timeout

      this.socket.on('open', () => {
        logger.info('Successfully connected to ElevenLabs Conversational WebSocket.');
        clearTimeout(connectionTimeout);
        
        // Send initial configuration
        const initMessage = {
          text: "Hello! I'm here to help. What would you like to talk about?",
          model_id: process.env.AGENT_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        };
        
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify(initMessage));
          logger.info('Sent initial configuration');
        }
        
        resolve();
      });

      this.socket.on('error', error => {
        clearTimeout(connectionTimeout);
        logger.error('WebSocket encountered an error:', error);
        reject(new Error(`WebSocket connection error: ${error.message}`));
      });

      this.socket.on('close', (code: number, reason: string) => {
        clearTimeout(connectionTimeout);
        logger.info(`ElevenLabs WebSocket closed with code ${code}. Reason: ${reason}`);
        this.cleanup();
        
        // Only attempt to reconnect if it wasn't a normal closure
        if (code !== 1000 && code !== 1001) {
          logger.info('Attempting to reconnect...');
          setTimeout(() => {
            this.connect().catch(error => {
              logger.error('Failed to reconnect:', error);
            });
          }, 1000);
        }
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
   * Ensures the buffer size is valid for ElevenLabs WebSocket
   * @private
   * @param {Buffer} buffer - Input buffer
   * @returns {Buffer} Adjusted buffer
   */
  private ensureValidBufferSize(buffer: Buffer): Buffer {
    // ElevenLabs expects buffer size to be a multiple of 2 (16-bit samples)
    if (buffer.length % 2 !== 0) {
      // Remove last byte to make it even
      return buffer.slice(0, buffer.length - 1);
    }
    return buffer;
  }

  /**
   * Appends input audio to the WebSocket.
   * @param {Buffer} buffer - The audio buffer to append.
   * @returns {void}
   */
  public appendInputAudio(buffer: Buffer): void {
    if (buffer.byteLength === 0 || this.socket?.readyState !== WebSocket.OPEN) return;

    try {
      // Ensure valid buffer size
      const validBuffer = this.ensureValidBufferSize(buffer);

      // Start listening mode if not already started
      if (!this.isListening) {
        this.isListening = true;
        this.lastTranscriptTime = Date.now();
      }

      // Format matches ElevenLabs WebSocket API
      const audioMessage = {
        audio: validBuffer.toString('base64'),
        model_id: process.env.AGENT_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      };

      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify(audioMessage));
      }

      // Check for transcript timeout
      const now = Date.now();
      if (now - this.lastTranscriptTime > this.TRANSCRIPT_TIMEOUT) {
        logger.debug('No transcript received for a while, resetting conversation state');
        this.isListening = false;
        this.lastTranscriptTime = now;
      }
    } catch (error) {
      logger.error('Error sending audio chunk:', error);
      // Don't throw - we want to keep the connection alive even if one chunk fails
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
        // Don't call cleanup here - just log the error
        // The stream will be recreated on next initialization
      });

      // Handle stream end
      this.currentAudioStream.on('end', () => {
        logger.debug('Audio stream ended normally');
        // Don't call cleanup - the stream ending is normal
      });

      const resource = createAudioResource(this.currentAudioStream, {
        inputType: StreamType.Raw,
      });

      // Handle audio player errors
      this.audioPlayer.on('error', (error) => {
        logger.error('Audio player error:', error);
        // Don't call cleanup - let the player recover
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
          
          // Ensure valid buffer size before conversion
          const validBuffer = this.ensureValidBufferSize(audioBuffer);
          const pcmBuffer = await AudioUtils.mono441kHzToStereo48kHz(validBuffer);
          
          if (!pcmBuffer || pcmBuffer.length === 0) {
            logger.error('Audio conversion failed or resulted in empty buffer');
            continue;
          }

          // Double check output buffer size
          if (pcmBuffer.length % 2 !== 0) {
            logger.warn('Invalid output buffer size, adjusting...');
            const adjustedBuffer = pcmBuffer.slice(0, pcmBuffer.length - 1);
            
            if (this.currentAudioStream && !this.currentAudioStream.destroyed) {
              const writeResult = this.currentAudioStream.write(adjustedBuffer);
              if (!writeResult) {
                await new Promise(resolve => this.currentAudioStream!.once('drain', resolve));
              }
            }
          } else {
            if (this.currentAudioStream && !this.currentAudioStream.destroyed) {
              const writeResult = this.currentAudioStream.write(pcmBuffer);
              if (!writeResult) {
                await new Promise(resolve => this.currentAudioStream!.once('drain', resolve));
              }
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
    try {
      if (!message.audio_event?.audio_base_64) {
        logger.warn('Received audio event without base64 data');
        return;
      }

      const audioBuffer = Buffer.from(message.audio_event.audio_base_64, 'base64');
      if (audioBuffer.length === 0) {
        logger.warn('Decoded audio buffer is empty');
        return;
      }

      this.audioBufferQueue.push(audioBuffer);
      await this.processAudioQueue();
    } catch (error) {
      logger.error('Error in handleAudio:', error);
      throw error; // Let caller handle it
    }
  }

  /**
   * Handles the agent response event.
   * @param {AgentResponseEvent} event - The agent response event.
   * @returns {void}
   */
  private handleAgentResponse(event: AgentResponseEvent): void {
    try {
      const response = event.agent_response_event.agent_response;
      logger.info('Agent Response:', response);

      // Reset listening state after agent responds
      this.isListening = false;

      // Send a ping to keep connection alive
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping' }));
      }
    } catch (error) {
      logger.error('Error handling agent response:', error);
    }
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
    try {
      this.currentConversationId = event.conversation_initiation_metadata_event.conversation_id;
      logger.info('Conversation started with ID:', this.currentConversationId);

      // Send initial greeting
      if (this.socket?.readyState === WebSocket.OPEN) {
        const greeting = {
          type: 'user_input',
          user_input: {
            text: 'Hello',
            mode: 'chat'
          }
        };
        this.socket.send(JSON.stringify(greeting));
        logger.info('Sent initial greeting');
      }
    } catch (error) {
      logger.error('Error handling conversation metadata:', error);
    }
  }

  /**
   * Handles events received from the WebSocket.
   * @param {WebSocket.RawData} message - The raw data message.
   * @returns {void}
   */
  private handleEvent(message: WebSocket.RawData): void {
    try {
      const rawMessage = message.toString();
      if (!rawMessage) {
        logger.warn('Received empty WebSocket message');
        return;
      }

      // Log raw message for debugging
      logger.debug('Raw WebSocket message:', rawMessage);

      const event = JSON.parse(rawMessage) as ElevenLabsEvent;
      
      // Validate event has a type
      if (!event || !event.type) {
        logger.warn('Received event without type:', event);
        return;
      }

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
        case 'ping':
          // Handle ping event silently
          break;
        case 'error':
          logger.error('ElevenLabs error:', event.error_event?.error_message || 'Unknown error');
          break;
        default:
          logger.warn('Unknown event type:', event.type, 'Full event:', event);
      }
    } catch (error) {
      logger.error('Error parsing WebSocket message:', error, 'Raw message:', message.toString());
      
      // Try to reconnect if we're getting parse errors
      this.handleWebSocketError();
    }
  }

  /**
   * Handles WebSocket errors and attempts reconnection
   * @private
   */
  private handleWebSocketError(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      logger.info('Attempting to reconnect WebSocket...');
      this.socket.close();
      this.socket = null;
      
      // Attempt reconnect after a short delay
      setTimeout(() => {
        this.connect().catch(error => {
          logger.error('Failed to reconnect:', error);
        });
      }, 1000);
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