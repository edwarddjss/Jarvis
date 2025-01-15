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

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.get('/callback', async (req, res) => {
    try {
        const code = req.query.code;
        
        if (!code) {
            logger.error('No authorization code received from Spotify');
            return res.status(400).send('No authorization code received');
        }

        if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
            logger.error('Missing Spotify credentials in environment variables');
            return res.status(500).send('Server configuration error');
        }

        logger.info('Received Spotify authorization code, exchanging for refresh token...');

        // Exchange the authorization code for refresh token
        const tokenResponse = await axios.post(
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

        const { refresh_token, access_token } = tokenResponse.data;

        if (!refresh_token) {
            logger.error('No refresh token received from Spotify');
            return res.status(500).send('Failed to obtain refresh token');
        }

        // Save tokens securely
        const tokenData = {
            refresh_token,
            access_token,
            timestamp: new Date().toISOString()
        };

        const configPath = path.join(process.cwd(), '.spotify_tokens.json');
        await fs.writeFile(configPath, JSON.stringify(tokenData, null, 2), 'utf-8');
        
        logger.info('Successfully obtained and saved Spotify refresh token');
        
        res.send('Authorization successful! You can close this window.');
    } catch (error) {
        logger.error(error, 'Error exchanging Spotify authorization code for refresh token');
        res.status(500).send('Error processing authorization');
    }
});

app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
    logger.info(`Spotify callback URL is set to: ${SPOTIFY_REDIRECT_URI}`);
});
