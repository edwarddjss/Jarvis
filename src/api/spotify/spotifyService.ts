import axios from 'axios';
import { logger } from '../../config/logger.js';

interface SpotifyTokens {
    access_token: string;
    token_type: string;
    expires_in: number;
}

interface SpotifyTrack {
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    duration_ms: number;
    external_urls: {
        spotify: string;
    };
    album?: {
        images: Array<{ url: string }>;
    };
}

export class SpotifyService {
    private static instance: SpotifyService;
    private accessToken: string | null = null;
    private tokenExpirationTime: number = 0;

    private constructor() {}

    public static getInstance(): SpotifyService {
        if (!SpotifyService.instance) {
            SpotifyService.instance = new SpotifyService();
        }
        return SpotifyService.instance;
    }

    private async refreshAccessToken(): Promise<void> {
        const clientId = process.env.SPOTIFY_CLIENT_ID;
        const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
        const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

        if (!clientId || !clientSecret || !refreshToken) {
            throw new Error('Missing Spotify credentials in environment variables');
        }

        try {
            const response = await axios.post<SpotifyTokens>(
                'https://accounts.spotify.com/api/token',
                new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                }),
                {
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            );

            this.accessToken = response.data.access_token;
            this.tokenExpirationTime = Date.now() + (response.data.expires_in * 1000);
            logger.info('Successfully refreshed Spotify access token');
        } catch (error) {
            logger.error(error, 'Failed to refresh Spotify access token');
            throw error;
        }
    }

    private async ensureValidToken(): Promise<string> {
        if (!this.accessToken || Date.now() >= this.tokenExpirationTime) {
            await this.refreshAccessToken();
        }
        return this.accessToken!;
    }

    private extractTrackId(url: string): string | null {
        try {
            if (url.includes('spotify.com/track/')) {
                const match = url.match(/track\/([a-zA-Z0-9]+)/);
                return match ? match[1] : null;
            }
            return null;
        } catch (error) {
            logger.error('Error extracting track ID:', error);
            return null;
        }
    }

    public async searchTracks(query: string): Promise<SpotifyTrack[]> {
        try {
            const token = await this.ensureValidToken();

            // Check if it's a Spotify URL
            const trackId = this.extractTrackId(query);
            if (trackId) {
                const response = await axios.get<SpotifyTrack>(
                    `https://api.spotify.com/v1/tracks/${trackId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    }
                );
                return [response.data];
            }

            // Regular search
            const response = await axios.get<{ tracks: { items: SpotifyTrack[] } }>(
                `https://api.spotify.com/v1/search`,
                {
                    params: {
                        q: query,
                        type: 'track',
                        limit: 5
                    },
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            return response.data.tracks.items;
        } catch (error) {
            logger.error('Failed to search Spotify tracks:', error);
            throw error;
        }
    }

    public formatTrackDuration(ms: number): string {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}
