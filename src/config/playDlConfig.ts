import { setToken } from 'play-dl';
import { logger } from './logger.js';

export async function initializePlayDl() {
    try {
        const youtubeCookie = process.env.YOUTUBE_COOKIE;
        if (youtubeCookie) {
            // Initialize play-dl with YouTube cookies if available
            await setToken({
                youtube: {
                    cookie: youtubeCookie
                }
            });
            logger.info('Initialized play-dl with YouTube authentication');
        } else {
            logger.warn('YOUTUBE_COOKIE not set - some YouTube features may be limited');
        }
    } catch (error) {
        logger.error(error, 'Failed to initialize play-dl');
        throw error;
    }
}
