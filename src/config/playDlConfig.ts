import { setToken } from 'play-dl';
import { logger } from './logger.js';

export async function initializePlayDl() {
    try {
        await setToken({
            spotify: {
                client_id: process.env.SPOTIFY_CLIENT_ID || '',
                client_secret: process.env.SPOTIFY_CLIENT_SECRET || '',
                refresh_token: process.env.SPOTIFY_REFRESH_TOKEN || '',
                market: process.env.SPOTIFY_MARKET || 'US'
            },
            soundcloud: {
                client_id: process.env.SOUNDCLOUD_CLIENT_ID || ''
            }
        });
        logger.info('Initialized play-dl with available music services');
    } catch (error) {
        logger.error(error, 'Failed to initialize play-dl');
        // Don't throw error, just log it - this allows the bot to work with YouTube even if other services fail
    }
}
