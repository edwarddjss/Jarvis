import axios from 'axios';
import SpotifyWebApi from 'spotify-web-api-node';
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
    private spotifyApi: SpotifyWebApi;

    private constructor() {
        this.spotifyApi = new SpotifyWebApi({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
            redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/callback'
        });
    }

    public static getInstance(): SpotifyService {
        if (!SpotifyService.instance) {
            SpotifyService.instance = new SpotifyService();
        }
        return SpotifyService.instance;
    }

    private async refreshAccessToken(): Promise<void> {
        try {
            const data = await this.spotifyApi.refreshAccessToken();
            this.accessToken = data.body.access_token;
            this.spotifyApi.setAccessToken(data.body.access_token);
            this.tokenExpirationTime = Date.now() + (data.body.expires_in * 1000);
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

    public extractTrackId(url: string): string | null {
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
            await this.ensureValidToken();

            // Check if it's a Spotify URL
            const trackId = this.extractTrackId(query);
            if (trackId) {
                const response = await this.spotifyApi.getTrack(trackId);
                return [response.body];
            }

            // Regular search
            const response = await this.spotifyApi.searchTracks(query, { limit: 5 });
            return response.body.tracks?.items || [];
        } catch (error) {
            logger.error('Failed to search Spotify tracks:', error);
            throw error;
        }
    }

    public async getStreamUrl(trackId: string): Promise<string> {
        try {
            await this.ensureValidToken();
            const response = await this.spotifyApi.getTrack(trackId);
            
            // Get the track's preview URL
            if (!response.body.preview_url) {
                throw new Error('No preview URL available for this track');
            }

            return response.body.preview_url;
        } catch (error) {
            logger.error('Failed to get stream URL:', error);
            throw error;
        }
    }

    public formatTrackDuration(ms: number): string {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}
