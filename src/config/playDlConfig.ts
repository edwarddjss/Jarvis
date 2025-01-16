import { setToken, getFreeClientID } from 'play-dl';
import play from 'play-dl';
import { logger } from './logger.js';

export async function initializePlayDl() {
    try {
        // Get a free SoundCloud client ID
        const clientID = await getFreeClientID();
        
        await setToken({
            spotify: {
                client_id: process.env.SPOTIFY_CLIENT_ID || '',
                client_secret: process.env.SPOTIFY_CLIENT_SECRET || '',
                refresh_token: process.env.SPOTIFY_REFRESH_TOKEN || '',
                market: process.env.SPOTIFY_MARKET || 'US'
            },
            soundcloud: {
                client_id: clientID || process.env.SOUNDCLOUD_CLIENT_ID || ''
            },
            youtube: {
                cookie: process.env.YOUTUBE_COOKIE || '',
                // @ts-ignore - These options are actually supported by play-dl but not in their types
                disable_web_requests: false,
                request_options: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                }
            }
        });

        // Test YouTube access
        logger.info('Testing YouTube access...');
        try {
            // Add a test video ID here
            const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
            await play.validate(testUrl);
            logger.info('YouTube access test successful');
        } catch (error) {
            logger.warn('YouTube access test failed. You may need to provide a valid YouTube cookie:', error);
        }

        logger.info('Initialized play-dl with available music services');
    } catch (error) {
        logger.error('Failed to initialize play-dl:', error);
        // Don't throw error, just log it - this allows the bot to work with other services even if some fail
    }
}
