import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';
import { logger } from '../config/index.js';

/**
 * Utility class for audio processing operations.
 */
class AudioUtils {
  /**
   * Converts mono 44.1kHz PCM audio to stereo 48kHz PCM audio.
   *
   * @param inputBuffer - The input PCM audio buffer in mono 44.1kHz format (signed 16-bit little-endian)
   * @returns Promise resolving to a Buffer containing stereo 48kHz PCM audio (signed 16-bit little-endian)
   * @throws {Error} If FFmpeg processing fails
   *
   */
  static async mono441kHzToStereo48kHz(inputBuffer: Buffer): Promise<Buffer> {
    // Early return for null or empty buffers
    if (!inputBuffer || inputBuffer.length === 0) {
      logger.error('Received empty or null input buffer');
      return inputBuffer;
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      try {
        // Log input buffer details
        logger.info(`Input buffer details - Length: ${inputBuffer.length}, First 10 bytes: ${inputBuffer.slice(0, 10).toString('hex')}`);

        ffmpeg(Readable.from(inputBuffer))
          .inputFormat('s16le')
          .inputOptions(['-ar 44100', '-ac 1', '-f s16le'])
          .outputFormat('s16le')
          .outputOptions(['-ar 48000', '-ac 2', '-af aresample=async=1:first_pts=0', '-f s16le'])
          .on('start', (cmdline) => {
            logger.info(`FFmpeg command: ${cmdline}`);
          })
          .on('error', (err) => {
            logger.error('FFmpeg conversion error:', {
              message: err.message,
              inputBufferLength: inputBuffer.length,
              inputBufferFirstBytes: inputBuffer.slice(0, 10).toString('hex')
            });
            reject(new Error(`FFmpeg error: ${err.message}`));
          })
          .pipe()
          .on('data', chunk => chunks.push(chunk))
          .on('end', () => {
            const outputBuffer = Buffer.concat(chunks);
            
            // Log output buffer details
            logger.info(`Output buffer details - Length: ${outputBuffer.length}, First 10 bytes: ${outputBuffer.slice(0, 10).toString('hex')}`);
            
            if (outputBuffer.length === 0) {
              logger.error('Conversion resulted in empty buffer');
              reject(new Error('Conversion resulted in empty buffer'));
            } else {
              resolve(outputBuffer);
            }
          })
          .on('error', (err) => {
            logger.error('Pipe stream error:', err);
            reject(err);
          });
      } catch (error) {
        logger.error('Unexpected error during audio conversion:', {
          message: error instanceof Error ? error.message : 'Unknown error',
          inputBufferLength: inputBuffer.length
        });
        reject(error);
      }
    });
  }
}

export { AudioUtils };