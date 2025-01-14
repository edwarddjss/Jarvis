import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { Readable } from 'stream';

if (ffmpegPath === null) {
  throw new Error('ffmpeg-static path is null');
}
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Utility class for audio processing operations.
 */
class AudioUtils {
  /**
   * Converts mono 44.1kHz PCM audio to stereo 48kHz PCM audio.
   */
  static async mono441kHzToStereo48kHz(inputBuffer: Buffer): Promise<Buffer> {
    if (!inputBuffer || inputBuffer.length === 0) {
      console.error('Received empty or null input buffer');
      return inputBuffer;
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let isStreamClosed = false;

      try {
        console.log(`Input buffer details - Length: ${inputBuffer.length}, First 10 bytes: ${inputBuffer.slice(0, 10).toString('hex')}`);

        const inputStream = Readable.from(inputBuffer);
        let command = ffmpeg(inputStream)
          .inputFormat('s16le')
          .inputOptions([
            '-ar 44100',
            '-ac 1',
            '-f s16le'
          ])
          .outputFormat('s16le')
          .outputOptions([
            '-ar 48000',
            '-ac 2',
            '-af', 'aresample=async=1:first_pts=0:min_hard_comp=0.100000:async=1000,aformat=sample_rates=48000:channel_layouts=stereo',
            '-f s16le'
          ])
          .on('start', (cmdline) => {
            console.log(`FFmpeg command: ${cmdline}`);
          })
          .on('error', (err) => {
            if (!isStreamClosed) {
              console.error('FFmpeg conversion error:', {
                message: err.message,
                inputBufferLength: inputBuffer.length,
                inputBufferFirstBytes: inputBuffer.slice(0, 10).toString('hex')
              });
              reject(new Error(`FFmpeg error: ${err.message}`));
            }
          });

        const outputStream = command.pipe();
        
        outputStream.on('data', chunk => {
          if (!isStreamClosed) {
            try {
              chunks.push(chunk);
            } catch (error) {
              console.error('Error pushing chunk:', error);
            }
          }
        });

        outputStream.on('end', () => {
          if (!isStreamClosed) {
            try {
              const outputBuffer = Buffer.concat(chunks);
              console.log(`Output buffer details - Length: ${outputBuffer.length}, First 10 bytes: ${outputBuffer.slice(0, 10).toString('hex')}`);
              
              if (outputBuffer.length === 0) {
                reject(new Error('Conversion resulted in empty buffer'));
              } else {
                resolve(outputBuffer);
              }
            } catch (error) {
              reject(error);
            }
          }
        });

        outputStream.on('error', (err) => {
          if (!isStreamClosed) {
            console.error('Output stream error:', err);
            reject(err);
          }
        });

        // Cleanup function
        const cleanup = () => {
          isStreamClosed = true;
          command.kill('SIGKILL');
          inputStream.destroy();
          outputStream.destroy();
        };

        // Handle premature stream closure
        outputStream.on('close', cleanup);
        inputStream.on('close', cleanup);

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