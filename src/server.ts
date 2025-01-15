import express from 'express';
import { logger } from './config/logger.js';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const port = process.env.PORT || 8080;

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

        logger.info(`Received Spotify authorization code: ${code}`);

        // Save the code to a file for later use
        const configPath = path.join(process.cwd(), 'spotify_auth_code.txt');
        await fs.writeFile(configPath, code.toString(), 'utf-8');
        
        logger.info(`Saved Spotify authorization code to ${configPath}`);
        
        res.send('Authorization successful! You can close this window.');
    } catch (error) {
        logger.error(error, 'Error handling Spotify callback');
        res.status(500).send('Error processing authorization');
    }
});

app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
});
