import { setToken } from 'play-dl';
import { logger } from './logger.js';

export async function initializePlayDl() {
    try {
        const youtubeCookie = process.env.YOUTUBE_COOKIE;
        if (!youtubeCookie) {
            throw new Error('YOUTUBE_COOKIE environment variable is not set');
        }
        // Initialize play-dl with YouTube cookies
        await setToken({
            youtube: {
                cookie: youtubeCookie
            }
        });
        logger.info('Initialized play-dl with YouTube authentication');
    } catch (error) {
        logger.error(error, 'Failed to initialize play-dl');
        throw error;
    }
}
