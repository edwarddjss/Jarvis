import play from 'play-dl';
import { logger } from '../../config/logger.js';
import type { InfoData, YouTubeVideo } from 'play-dl';
import { StreamType } from '@discordjs/voice';

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

    public async getStream(url: string) {
        try {
            logger.info(`Getting stream for URL: ${url}`);
            
            // First validate the URL
            const validateResult = await play.validate(url);
            logger.info(`URL validation result: ${validateResult}`);
            
            if (validateResult !== 'yt_video') {
                throw new Error('Invalid YouTube URL');
            }

            // Get video info first
            const info = await play.video_info(url);
            logger.info(`Got video info for: ${info.video_details.title}`);

            // Get the stream
            const stream = await play.stream(url, {
                discordPlayerCompatibility: true
            });
            
            logger.info('Stream created successfully');
            
            return {
                stream: stream.stream,
                type: StreamType.Opus
            };
        } catch (error) {
            logger.error('Failed to get YouTube stream:', error);
            throw error;
        }
    }

    private formatDuration(seconds: number): string {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}
