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
const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN;

// Error handling utility
function handleError(error: unknown): string {
    if (error instanceof AxiosError) {
        const response = error.response?.data;
        const status = error.response?.status;
        const url = error.config?.url;
        return `${error.message} - Status: ${status}, URL: ${url}, Response: ${JSON.stringify(response)}`;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

// Log Spotify token response safely
function logTokenResponse(data: any) {
    const { refresh_token, access_token, expires_in, token_type, scope } = data;
    logger.info('Received Spotify token response:', {
        refresh_token: refresh_token ? `${refresh_token.slice(0, 5)}...${refresh_token.slice(-5)}` : 'Missing',
        access_token: access_token ? `${access_token.slice(0, 5)}...${access_token.slice(-5)}` : 'Missing',
        expires_in,
        token_type,
        scope,
        timestamp: new Date().toISOString()
    });
}

// Update Railway variables using the correct API
async function updateRailwayVariables(variables: Record<string, string>) {
    if (!RAILWAY_API_TOKEN) {
        throw new Error('Missing RAILWAY_API_TOKEN');
    }

    try {
        logger.info('Attempting to update Railway variables');
        
        // First, get the current project ID
        const projectResponse = await axios.get('https://api.railway.app/graphql/v2', {
            headers: {
                'Authorization': `Bearer ${RAILWAY_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                query: `
                    query {
                        me {
                            projects {
                                edges {
                                    node {
                                        id
                                        name
                                    }
                                }
                            }
                        }
                    }
                `
            }
        });

        logger.debug('Railway projects response:', projectResponse.data);

        // Then update the variables
        const response = await axios.post('https://api.railway.app/graphql/v2', {
            query: `
                mutation($input: VariableCollectionUpsertInput!) {
                    variableCollectionUpsert(input: $input) {
                        id
                    }
                }
            `,
            variables: {
                input: {
                    variables: Object.entries(variables).map(([key, value]) => ({
                        name: key,
                        value: value
                    }))
                }
            }
        }, {
            headers: {
                'Authorization': `Bearer ${RAILWAY_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        logger.info('Successfully updated Railway variables');
        logger.debug('Railway update response:', response.data);
        
        return response.data;
    } catch (error) {
        const errorMessage = handleError(error);
        logger.error({ err: error }, `Failed to update Railway variables: ${errorMessage}`);
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
            has_code: !!req.query.code,
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

        try {
            // Exchange the code for tokens
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

            logger.info('Successfully received token response from Spotify');
            
            // Log the full response data (safely)
            logTokenResponse(tokenResponse.data);

            const { refresh_token, access_token } = tokenResponse.data;

            if (!refresh_token || !access_token) {
                logger.error('Missing required tokens in Spotify response:', {
                    has_refresh_token: !!refresh_token,
                    has_access_token: !!access_token,
                    response_keys: Object.keys(tokenResponse.data)
                });
                throw new Error('Missing required tokens in Spotify response');
            }

            // Store tokens in Railway
            await updateRailwayVariables({
                SPOTIFY_REFRESH_TOKEN: refresh_token,
                SPOTIFY_ACCESS_TOKEN: access_token,
                SPOTIFY_TOKEN_TIMESTAMP: new Date().toISOString()
            });

            logger.info('Successfully stored Spotify tokens in Railway');
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
app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
    logger.info(`Spotify callback URL is set to: ${SPOTIFY_REDIRECT_URI}`);
    
    // Log configuration status
    logger.debug('Configuration status:', {
        has_spotify_client_id: !!SPOTIFY_CLIENT_ID,
        has_spotify_client_secret: !!SPOTIFY_CLIENT_SECRET,
        has_railway_token: !!RAILWAY_API_TOKEN
    });
});
