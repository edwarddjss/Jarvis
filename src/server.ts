import express from 'express';
import { logger } from './config/logger.js';
import axios, { AxiosError } from 'axios';

const app = express();
const port = process.env.PORT || 8080;

// Spotify configuration
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${port}/callback`;

// Railway configuration
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID;
const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN;
const RAILWAY_SERVICE_ID = process.env.RAILWAY_SERVICE_ID;
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID;

// Error handling utility
function handleError(error: unknown): string {
    if (error instanceof AxiosError) {
        return `${error.message} - ${JSON.stringify(error.response?.data || {})}`;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

// Update Railway environment variables
async function updateRailwayVariables(variables: Record<string, string>) {
    if (!RAILWAY_API_TOKEN || !RAILWAY_PROJECT_ID || !RAILWAY_SERVICE_ID || !RAILWAY_ENVIRONMENT_ID) {
        throw new Error('Missing Railway configuration');
    }

    try {
        const response = await axios.patch(
            `https://backboard.railway.app/api/projects/${RAILWAY_PROJECT_ID}/services/${RAILWAY_SERVICE_ID}/variables`,
            {
                variables: Object.entries(variables).map(([key, value]) => ({
                    name: key,
                    value: value,
                    environment: RAILWAY_ENVIRONMENT_ID
                }))
            },
            {
                headers: {
                    'Authorization': `Bearer ${RAILWAY_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        logger.info('Successfully updated Railway variables');
        return response.data;
    } catch (error) {
        logger.error({ err: error }, `Failed to update Railway variables: ${handleError(error)}`);
        throw error;
    }
}

// Verify Railway variables
async function verifyRailwayVariables(expectedVars: string[]) {
    if (!RAILWAY_API_TOKEN || !RAILWAY_PROJECT_ID || !RAILWAY_SERVICE_ID) {
        throw new Error('Missing Railway configuration');
    }

    try {
        const response = await axios.get(
            `https://backboard.railway.app/api/projects/${RAILWAY_PROJECT_ID}/services/${RAILWAY_SERVICE_ID}/variables`,
            {
                headers: {
                    'Authorization': `Bearer ${RAILWAY_API_TOKEN}`
                }
            }
        );

        const variables = response.data.variables || [];
        const missingVars = expectedVars.filter(varName => 
            !variables.some((v: any) => v.name === varName)
        );

        if (missingVars.length > 0) {
            logger.warn(`Missing Railway variables: ${missingVars.join(', ')}`);
            return false;
        }

        logger.info('Successfully verified all Railway variables are present');
        return true;
    } catch (error) {
        logger.error({ err: error }, `Failed to verify Railway variables: ${handleError(error)}`);
        throw error;
    }
}

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.get('/callback', async (req, res) => {
    try {
        logger.info('Received Spotify callback request');
        logger.debug('Query parameters:', {
            code: req.query.code ? 'Present' : 'Missing',
            state: req.query.state,
            error: req.query.error
        });
        
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
            const params = new URLSearchParams({
                grant_type: 'authorization_code',
                code: code.toString(),
                redirect_uri: SPOTIFY_REDIRECT_URI,
                client_id: SPOTIFY_CLIENT_ID,
                client_secret: SPOTIFY_CLIENT_SECRET
            });

            tokenResponse = await axios.post(SPOTIFY_TOKEN_URL, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            logger.info('Successfully received token response from Spotify');
            
            // Log tokens for debugging (partial tokens only)
            const { refresh_token, access_token } = tokenResponse.data;
            logger.debug('Received tokens:', {
                refresh_token: refresh_token ? `${refresh_token.substring(0, 5)}...${refresh_token.substring(refresh_token.length - 5)}` : 'Missing',
                access_token: access_token ? `${access_token.substring(0, 5)}...${access_token.substring(access_token.length - 5)}` : 'Missing',
                token_type: tokenResponse.data.token_type,
                expires_in: tokenResponse.data.expires_in
            });

            if (!refresh_token || !access_token) {
                throw new Error('Missing required tokens in Spotify response');
            }

            // Store tokens in Railway
            const variables = {
                SPOTIFY_REFRESH_TOKEN: refresh_token,
                SPOTIFY_ACCESS_TOKEN: access_token,
                SPOTIFY_TOKEN_TIMESTAMP: new Date().toISOString()
            };

            await updateRailwayVariables(variables);
            
            // Verify the variables were stored
            const verified = await verifyRailwayVariables([
                'SPOTIFY_REFRESH_TOKEN',
                'SPOTIFY_ACCESS_TOKEN',
                'SPOTIFY_TOKEN_TIMESTAMP'
            ]);

            if (!verified) {
                throw new Error('Failed to verify Railway variables after update');
            }

            logger.info('Successfully stored and verified Spotify tokens in Railway');
            res.send('Authorization successful! You can close this window.');
        } catch (error) {
            const errorMessage = handleError(error);
            logger.error({ err: error }, `Failed to process Spotify authorization: ${errorMessage}`);
            res.status(500).send('Failed to process authorization');
        }
    } catch (error) {
        logger.error({ err: error }, `Unhandled error in Spotify callback: ${handleError(error)}`);
        res.status(500).send('Error processing authorization');
    }
});

// Log startup information
app.listen(port, async () => {
    logger.info(`Server is running on port ${port}`);
    logger.info(`Spotify callback URL is set to: ${SPOTIFY_REDIRECT_URI}`);
    
    // Verify Railway configuration
    logger.debug('Railway configuration:', {
        has_project_id: !!RAILWAY_PROJECT_ID,
        has_api_token: !!RAILWAY_API_TOKEN,
        has_service_id: !!RAILWAY_SERVICE_ID,
        has_environment_id: !!RAILWAY_ENVIRONMENT_ID
    });

    // Check current Railway variables
    try {
        await verifyRailwayVariables([
            'SPOTIFY_REFRESH_TOKEN',
            'SPOTIFY_ACCESS_TOKEN',
            'SPOTIFY_TOKEN_TIMESTAMP'
        ]);
    } catch (error) {
        logger.warn('Could not verify Railway variables during startup');
    }
});
