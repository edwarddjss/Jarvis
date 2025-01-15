// src/api/discord/musicHandler.ts
import { 
    AudioPlayer, 
    createAudioResource,
    AudioResource,
    createAudioPlayer,
    VoiceConnection,
    AudioPlayerStatus,
    VoiceConnectionStatus
} from '@discordjs/voice';
import { stream, video_info } from 'play-dl';
import { TextChannel, NewsChannel, ThreadChannel, DMChannel } from 'discord.js';
import { logger } from '../../config/logger.js';

type SendableChannel = TextChannel | NewsChannel | ThreadChannel | DMChannel;

interface QueueItem {
    url: string;
    title: string;
    requestedBy: string;
    duration: string;
}

interface GuildQueueData {
    audioPlayer: AudioPlayer;
    connection: VoiceConnection;
    queue: QueueItem[];
    filters: {
        bassboost: boolean;
        volume: number;
    };
    textChannel: SendableChannel;
    currentResource: AudioResource | null;
    currentItem: QueueItem | null;
    timeout: NodeJS.Timeout | null;
}

export class MusicHandler {
    private static instance: MusicHandler;
    private queues: Map<string, GuildQueueData>;
    private readonly IDLE_TIMEOUT = 300000; // 5 minutes

    private constructor() {
        this.queues = new Map();
    }

    public static getInstance(): MusicHandler {
        if (!MusicHandler.instance) {
            MusicHandler.instance = new MusicHandler();
        }
        return MusicHandler.instance;
    }

    private getOrCreateGuildData(
        guildId: string,
        connection: VoiceConnection,
        textChannel: SendableChannel
    ): GuildQueueData {
        let guildData = this.queues.get(guildId);

        if (!guildData) {
            const audioPlayer = createAudioPlayer();
            guildData = {
                audioPlayer,
                connection,
                queue: [],
                filters: {
                    bassboost: false,
                    volume: 1.0
                },
                textChannel,
                currentResource: null,
                currentItem: null,
                timeout: null
            };

            audioPlayer.on(AudioPlayerStatus.Idle, () => {
                this.handleTrackEnd(guildId);
            });

            audioPlayer.on('error', (error) => {
                logger.error(error, `Audio player error in guild ${guildId}`);
                this.handleTrackEnd(guildId);
            });

            connection.on(VoiceConnectionStatus.Disconnected, () => {
                this.cleanup(guildId);
            });

            connection.subscribe(audioPlayer);
            this.queues.set(guildId, guildData);
        }

        return guildData;
    }

    public async addTrack(
        guildId: string,
        connection: VoiceConnection,
        textChannel: SendableChannel,
        url: string,
        requestedBy: string
    ): Promise<void> {
        try {
            const guildData = this.getOrCreateGuildData(guildId, connection, textChannel);

            const videoInfo = await video_info(url);
            const video = videoInfo.video_details;

            const queueItem: QueueItem = {
                url,
                title: video.title ?? 'Unknown Title',
                requestedBy,
                duration: video.durationRaw
            };

            guildData.queue.push(queueItem);

            if (!guildData.currentItem) {
                await this.processQueue(guildId);
            } else {
                await guildData.textChannel.send(
                    `🎵 Added to queue: ${queueItem.title}`
                );
            }
        } catch (error) {
            logger.error(error, `Error adding track in guild ${guildId}`);
            throw error;
        }
    }

    private async processQueue(guildId: string): Promise<void> {
        const guildData = this.queues.get(guildId);
        if (!guildData || guildData.queue.length === 0) {
            this.startIdleTimeout(guildId);
            return;
        }

        try {
            const nextTrack = guildData.queue.shift()!;
            guildData.currentItem = nextTrack;

            const audioStream = await stream(nextTrack.url);
            guildData.currentResource = createAudioResource(audioStream.stream, {
                inputType: audioStream.type,
                inlineVolume: true
            });

            if (guildData.currentResource.volume) {
                const volume = guildData.filters.bassboost 
                    ? guildData.filters.volume * 1.5 
                    : guildData.filters.volume;
                guildData.currentResource.volume.setVolume(volume);
            }

            guildData.audioPlayer.play(guildData.currentResource);

            if (guildData.timeout) {
                clearTimeout(guildData.timeout);
                guildData.timeout = null;
            }

            await guildData.textChannel.send(
                `🎵 Now playing: ${nextTrack.title}`
            );
        } catch (error) {
            logger.error(error, `Error processing queue in guild ${guildId}`);
            try {
                await guildData.textChannel.send('❌ Error playing track, skipping...');
            } catch (sendError) {
                logger.error(sendError, 'Failed to send error message to channel');
            }
            this.handleTrackEnd(guildId);
        }
    }

    private handleTrackEnd(guildId: string): void {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        guildData.currentItem = null;
        guildData.currentResource = null;

        if (guildData.queue.length > 0) {
            this.processQueue(guildId);
        } else {
            this.startIdleTimeout(guildId);
        }
    }

    private startIdleTimeout(guildId: string): void {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        if (guildData.timeout) {
            clearTimeout(guildData.timeout);
        }

        guildData.timeout = setTimeout(() => {
            this.cleanup(guildId);
        }, this.IDLE_TIMEOUT);
    }

    private cleanup(guildId: string): void {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        if (guildData.timeout) {
            clearTimeout(guildData.timeout);
        }

        guildData.audioPlayer.stop(true);
        guildData.connection.destroy();
        this.queues.delete(guildId);
    }

    public stop(guildId: string): void {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        guildData.queue = [];
        guildData.audioPlayer.stop(true);
        guildData.currentItem = null;
        guildData.currentResource = null;
        this.startIdleTimeout(guildId);
    }

    public toggleBassboost(guildId: string): boolean {
        const guildData = this.queues.get(guildId);
        if (!guildData) return false;

        guildData.filters.bassboost = !guildData.filters.bassboost;

        if (guildData.currentResource?.volume) {
            const volume = guildData.filters.bassboost 
                ? guildData.filters.volume * 1.5 
                : guildData.filters.volume;
            guildData.currentResource.volume.setVolume(volume);
        }

        return guildData.filters.bassboost;
    }

    public clearFilters(guildId: string): void {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        guildData.filters = {
            bassboost: false,
            volume: 1.0
        };

        if (guildData.currentResource?.volume) {
            guildData.currentResource.volume.setVolume(1.0);
        }
    }

    public getQueue(guildId: string): QueueItem[] {
        return this.queues.get(guildId)?.queue || [];
    }

    public getCurrentTrack(guildId: string): QueueItem | null {
        return this.queues.get(guildId)?.currentItem || null;
    }

    public skip(guildId: string): void {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        guildData.audioPlayer.stop(true);
    }

    public setVolume(guildId: string, volume: number): boolean {
        const guildData = this.queues.get(guildId);
        if (!guildData) return false;

        const normalizedVolume = Math.max(0, Math.min(2, volume));
        guildData.filters.volume = normalizedVolume;

        if (guildData.currentResource?.volume) {
            const finalVolume = guildData.filters.bassboost 
                ? normalizedVolume * 1.5 
                : normalizedVolume;
            guildData.currentResource.volume.setVolume(finalVolume);
            return true;
        }

        return false;
    }
}