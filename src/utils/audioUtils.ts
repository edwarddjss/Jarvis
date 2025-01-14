import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';

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
      console.error('Received empty or null input buffer');
      return inputBuffer;
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      try {
        // Log input buffer details
        console.log(`Input buffer details - Length: ${inputBuffer.length}, First 10 bytes: ${inputBuffer.slice(0, 10).toString('hex')}`);

        const inputStream = Readable.from(inputBuffer);

        ffmpeg(inputStream)
          .inputFormat('s16le')
          .inputOptions([
            '-ar 44100',   // Input sample rate
            '-ac 1',       // Input channels (mono)
            '-f s16le'     // Input format
          ])
          .outputFormat('s16le')
          .outputOptions([
            '-ar 48000',   // Output sample rate
            '-ac 2',       // Output channels (stereo)
            '-af', 'aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo', 
            '-f s16le'     // Output format
          ])
          .on('start', (cmdline) => {
            console.log(`FFmpeg command: ${cmdline}`);
          })
          .on('error', (err) => {
            console.error('FFmpeg conversion error:', {
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
            console.log(`Output buffer details - Length: ${outputBuffer.length}, First 10 bytes: ${outputBuffer.slice(0, 10).toString('hex')}`);
            
            if (outputBuffer.length === 0) {
              console.error('Conversion resulted in empty buffer');
              reject(new Error('Conversion resulted in empty buffer'));
            } else {
              resolve(outputBuffer);
            }
          })
          .on('error', (err) => {
            console.error('Pipe stream error:', err);
            reject(err);
          });
      } catch (error) {
        console.error('Unexpected error during audio conversion:', {
          message: error instanceof Error ? error.message : 'Unknown error',
          inputBufferLength: inputBuffer.length
        });
        reject(error);
      }
    });
  }
}

export { AudioUtils };