import play from 'play-dl';
import { StreamType } from '@discordjs/voice';
import { logger } from '../../config/logger.js';
import type { InfoData, YouTubeVideo } from 'play-dl';

export interface YouTubeTrack {
    id: string;
    title: string;
    url: string;
    thumbnail: string;
    duration: string;
    author: {
        name: string;
        url: string;
    };
}

export class YouTubeService {
    private static instance: YouTubeService;

    private constructor() {}

    public static getInstance(): YouTubeService {
        if (!YouTubeService.instance) {
            YouTubeService.instance = new YouTubeService();
        }
        return YouTubeService.instance;
    }

    public async searchTracks(query: string): Promise<YouTubeTrack[]> {
        try {
            const searchResults = await play.search(query, {
                limit: 5,
                source: { youtube: "video" }
            });

            return searchResults.map((video: YouTubeVideo) => ({
                id: video.id || '',
                title: video.title || '',
                url: video.url,
                thumbnail: video.thumbnails[0]?.url || '',
                duration: this.formatDuration(video.durationInSec || 0),
                author: {
                    name: video.channel?.name || 'Unknown Artist',
                    url: video.channel?.url || ''
                }
            }));
        } catch (error) {
            logger.error('Failed to search YouTube tracks:', error);
            throw error;
        }
    }

    private async retry<T>(operation: () => Promise<T>, maxAttempts: number = 3): Promise<T> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                lastError = new Error(`Attempt ${attempt} failed: ${errorMessage}`);
                logger.error(`Attempt ${attempt}/${maxAttempts} failed: ${errorMessage}`);
                
                if (attempt < maxAttempts) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw lastError || new Error('Operation failed after all attempts');
    }

    public async getStream(url: string) {
        return this.retry(async () => {
            logger.info(`Getting stream for URL: ${url}`);
            
            // First validate the URL
            const validateResult = await play.validate(url);
            logger.info(`URL validation result: ${validateResult}`);
            
            if (validateResult !== 'yt_video') {
                throw new Error('Invalid YouTube URL');
            }

            // Get video info first
            const info = await play.video_info(url);
            if (!info) {
                throw new Error('Could not get video info');
            }

            logger.info(`Got video info for: ${info.video_details.title}`);
            logger.info(`Video duration: ${info.video_details.durationInSec} seconds`);

            // Get the stream with specific options
            try {
                const stream = await play.stream(url, {
                    discordPlayerCompatibility: true,
                    quality: 2, // Try a lower quality setting
                    seek: 0
                });
                
                if (!stream || !stream.stream) {
                    throw new Error('Failed to create stream object');
                }

                logger.info('Stream created successfully');

                // Add error handler to the stream
                stream.stream
                    .on('error', (error) => {
                        logger.error('Stream error:', error);
                    })
                    .on('end', () => {
                        logger.info('Stream ended');
                    })
                    .on('close', () => {
                        logger.info('Stream closed');
                    })
                    .on('data', () => {
                        logger.debug('Stream receiving data');
                    });
                
                return {
                    stream: stream.stream,
                    type: StreamType.Opus
                };
            } catch (error: any) {
                if (error.message.includes('Sign in to confirm you\'re not a bot')) {
                    logger.error('YouTube authentication required. Please set a valid YOUTUBE_COOKIE in your environment variables.');
                    throw new Error('YouTube authentication required. The bot needs valid credentials to stream music.');
                }
                logger.error('Stream error:', error);
                throw error;
            }
        });
    }

    private formatDuration(seconds: number): string {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}
