import express from 'express';
import { logger } from './config/logger.js';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';

const app = express();
const port = process.env.PORT || 8080;

// Spotify configuration
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${port}/callback`;

// Ensure the directory exists for token storage
async function ensureTokenDirectory() {
    const tokenDir = process.cwd();
    try {
        await fs.access(tokenDir);
        logger.info(`Token directory exists: ${tokenDir}`);
    } catch (error) {
        logger.error(error, `Error accessing token directory: ${tokenDir}`);
        throw error;
    }
}

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.get('/callback', async (req, res) => {
    try {
        logger.info('Received Spotify callback request');
        logger.debug(`Query parameters: ${JSON.stringify(req.query)}`);
        
        const code = req.query.code;
        
        if (!code) {
            logger.error('No authorization code received from Spotify');
            return res.status(400).send('No authorization code received');
        }

        if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
            logger.error('Missing Spotify credentials in environment variables');
            return res.status(500).send('Server configuration error');
        }

        logger.info('Exchanging authorization code for refresh token...');

        // Exchange the authorization code for refresh token
        let tokenResponse;
        try {
            tokenResponse = await axios.post(
                SPOTIFY_TOKEN_URL,
                new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code.toString(),
                    redirect_uri: SPOTIFY_REDIRECT_URI,
                    client_id: SPOTIFY_CLIENT_ID,
                    client_secret: SPOTIFY_CLIENT_SECRET
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
            logger.info('Successfully received token response from Spotify');
        } catch (error) {
            logger.error(error, 'Failed to exchange authorization code for tokens');
            logger.error(`Spotify API Error Response: ${JSON.stringify(error.response?.data || {})}`);
            return res.status(500).send('Failed to exchange authorization code');
        }

        const { refresh_token, access_token } = tokenResponse.data;

        if (!refresh_token) {
            logger.error('No refresh token received from Spotify');
            logger.error(`Token response data: ${JSON.stringify(tokenResponse.data)}`);
            return res.status(500).send('Failed to obtain refresh token');
        }

        // Ensure we can access the directory before attempting to write
        try {
            await ensureTokenDirectory();
        } catch (error) {
            logger.error(error, 'Failed to access token directory');
            return res.status(500).send('Server storage error');
        }

        // Save tokens securely
        const tokenData = {
            refresh_token,
            access_token,
            timestamp: new Date().toISOString()
        };

        const configPath = path.join(process.cwd(), '.spotify_tokens.json');
        logger.info(`Attempting to save tokens to: ${configPath}`);

        try {
            await fs.writeFile(configPath, JSON.stringify(tokenData, null, 2), 'utf-8');
            
            // Verify the file was created
            const stats = await fs.stat(configPath);
            logger.info(`Token file created successfully. Size: ${stats.size} bytes`);
            
            // Verify we can read the file
            const content = await fs.readFile(configPath, 'utf-8');
            const parsedContent = JSON.parse(content);
            if (!parsedContent.refresh_token) {
                throw new Error('Saved file does not contain refresh token');
            }
            logger.info('Successfully verified token file contents');
        } catch (error) {
            logger.error(error, 'Failed to save or verify token file');
            return res.status(500).send('Failed to save authorization tokens');
        }
        
        logger.info('Spotify authorization process completed successfully');
        res.send('Authorization successful! You can close this window.');
    } catch (error) {
        logger.error(error, 'Unhandled error in Spotify callback');
        res.status(500).send('Error processing authorization');
    }
});

// Log startup information
app.listen(port, async () => {
    logger.info(`Server is running on port ${port}`);
    logger.info(`Spotify callback URL is set to: ${SPOTIFY_REDIRECT_URI}`);
    
    try {
        await ensureTokenDirectory();
        logger.info('Token directory is accessible');
    } catch (error) {
        logger.error(error, 'Failed to access token directory during startup');
    }
});
