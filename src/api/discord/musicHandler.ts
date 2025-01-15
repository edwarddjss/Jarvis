// src/api/discord/musicHandler.ts
import { 
    AudioPlayer, 
    createAudioResource,
    AudioResource,
    createAudioPlayer,
    VoiceConnection,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    NoSubscriberBehavior
} from '@discordjs/voice';
import { TextChannel, NewsChannel, ThreadChannel, DMChannel, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, ButtonInteraction } from 'discord.js';
import { logger } from '../../config/logger.js';
import { VoiceStateManager } from './voiceStateManager.js';
import { SpotifyService } from '../spotify/spotifyService.js';
import { stream } from 'play-dl';

type SendableChannel = TextChannel | NewsChannel | ThreadChannel | DMChannel;

interface QueueItem {
    url: string;
    title: string;
    requestedBy: string;
    duration: string;
    thumbnail?: string;
    artist?: string;
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
    private stateManager: VoiceStateManager;
    private spotifyService: SpotifyService;

    private constructor() {
        this.queues = new Map();
        this.stateManager = VoiceStateManager.getInstance();
        this.spotifyService = SpotifyService.getInstance();
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
            const audioPlayer = createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Play
                }
            });

            guildData = {
                audioPlayer,
                connection,
                queue: [],
                filters: {
                    bassboost: false,
                    volume: 1
                },
                textChannel,
                currentResource: null,
                currentItem: null,
                timeout: null
            };

            this.queues.set(guildId, guildData);
            connection.subscribe(audioPlayer);

            audioPlayer.on(AudioPlayerStatus.Idle, () => {
                this.handleTrackEnd(guildId);
            });

            audioPlayer.on('error', error => {
                logger.error(error, `Error in audio player for guild ${guildId}`);
                this.handleTrackEnd(guildId);
            });

            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                } catch (error) {
                    this.cleanup(guildId);
                }
            });
        }

        return guildData;
    }

    public async searchAndShowResults(
        guildId: string,
        connection: VoiceConnection,
        textChannel: SendableChannel,
        query: string,
        requestedBy: string
    ): Promise<void> {
        try {
            const tracks = await this.spotifyService.searchTracks(query);
            
            if (tracks.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('No Results Found')
                    .setDescription('❌ No tracks found matching your search query.')
                    .setTimestamp();
                await textChannel.send({ embeds: [embed] });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor('#1DB954')
                .setTitle('Search Results')
                .setDescription(`🔍 Results for: "${query}"`)
                .addFields(
                    tracks.slice(0, 5).map((track, index) => ({
                        name: `${index + 1}. ${track.name}`,
                        value: `👤 ${track.artists.map(a => a.name).join(', ')}\n⏱️ ${this.spotifyService.formatTrackDuration(track.duration_ms)}`
                    }))
                )
                .setThumbnail(tracks[0]?.external_urls?.spotify || 'https://i.imgur.com/IbS3k6R.png')
                .setFooter({ text: 'Select a track within 30 seconds', iconURL: 'https://i.imgur.com/IbS3k6R.png' });

            const buttons = tracks.slice(0, 5).map((track, index) => {
                return new ButtonBuilder()
                    .setCustomId(`play_${index}_${guildId}`)
                    .setLabel(`${index + 1}`)
                    .setEmoji('▶️')
                    .setStyle(ButtonStyle.Success);
            });

            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(buttons);

            const message = await textChannel.send({
                embeds: [embed],
                components: [row]
            });

            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 30000
            });

            collector.on('collect', async (i: ButtonInteraction) => {
                if (!i.customId.startsWith('play_')) return;

                const [_, index, trackGuildId] = i.customId.split('_');
                if (trackGuildId !== guildId) return;

                await i.deferUpdate();
                const selectedTrack = tracks[parseInt(index)];

                const guildData = this.getOrCreateGuildData(guildId, connection, textChannel);
                const queueItem: QueueItem = {
                    url: selectedTrack.external_urls.spotify,
                    title: selectedTrack.name,
                    requestedBy,
                    duration: this.spotifyService.formatTrackDuration(selectedTrack.duration_ms),
                    artist: selectedTrack.artists.map(a => a.name).join(', '),
                    thumbnail: selectedTrack.external_urls.spotify
                };

                guildData.queue.push(queueItem);

                const addedEmbed = new EmbedBuilder()
                    .setColor('#1DB954')
                    .setTitle(queueItem.title)
                    .setURL(queueItem.url)
                    .setDescription(`Added to queue by ${requestedBy}`)
                    .addFields(
                        { name: 'Artist', value: queueItem.artist || 'Unknown Artist', inline: true },
                        { name: 'Duration', value: queueItem.duration, inline: true },
                        { name: 'Position', value: `#${guildData.queue.length}`, inline: true }
                    )
                    .setThumbnail(queueItem.thumbnail || 'https://i.imgur.com/IbS3k6R.png')
                    .setTimestamp();

                await message.edit({ embeds: [embed], components: [] });
                await textChannel.send({ embeds: [addedEmbed] });

                if (!guildData.currentItem) {
                    await this.processQueue(guildId);
                }

                collector.stop();
            });

            collector.on('end', async () => {
                try {
                    const expiredEmbed = embed.setColor('#808080')
                        .setDescription('❌ Search results have expired. Please try again.');
                    await message.edit({
                        embeds: [expiredEmbed],
                        components: []
                    });
                } catch (error) {
                    logger.error('Error removing search results buttons:', error);
                }
            });

        } catch (error) {
            logger.error('Error searching for tracks:', error);
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Error')
                .setDescription('❌ An error occurred while searching. Please try again.')
                .setTimestamp();
            await textChannel.send({ embeds: [errorEmbed] });
        }
    }

    public async addSpotifyTrack(
        guildId: string,
        connection: VoiceConnection,
        textChannel: SendableChannel,
        url: string,
        requestedBy: string
    ): Promise<void> {
        try {
            const track = await this.spotifyService.searchTracks(url);
            if (!track || track.length === 0) {
                throw new Error('Track not found');
            }

            const guildData = this.getOrCreateGuildData(guildId, connection, textChannel);
            const queueItem: QueueItem = {
                url: track[0].external_urls.spotify,
                title: track[0].name,
                requestedBy,
                duration: this.spotifyService.formatTrackDuration(track[0].duration_ms),
                artist: track[0].artists.map(a => a.name).join(', '),
                thumbnail: track[0].external_urls.spotify
            };

            guildData.queue.push(queueItem);

            const addedEmbed = new EmbedBuilder()
                .setColor('#1DB954')
                .setTitle(queueItem.title)
                .setURL(queueItem.url)
                .setDescription(`Added to queue by ${requestedBy}`)
                .addFields(
                    { name: 'Artist', value: queueItem.artist || 'Unknown Artist', inline: true },
                    { name: 'Duration', value: queueItem.duration, inline: true },
                    { name: 'Position', value: `#${guildData.queue.length}`, inline: true }
                )
                .setThumbnail(queueItem.thumbnail || 'https://i.imgur.com/IbS3k6R.png')
                .setTimestamp();

            await textChannel.send({ embeds: [addedEmbed] });

            if (!guildData.currentItem) {
                await this.processQueue(guildId);
            }
        } catch (error) {
            logger.error('Error adding Spotify track:', error);
            throw error;
        }
    }

    public async processQueue(guildId: string): Promise<void> {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        if (guildData.timeout) {
            clearTimeout(guildData.timeout);
            guildData.timeout = null;
        }

        if (guildData.queue.length === 0) {
            this.startIdleTimeout(guildId);
            return;
        }

        const nextTrack = guildData.queue.shift()!;
        guildData.currentItem = nextTrack;

        try {
            if (guildData.connection.state.status !== VoiceConnectionStatus.Ready) {
                try {
                    await entersState(guildData.connection, VoiceConnectionStatus.Ready, 5_000);
                } catch (error) {
                    logger.error('Voice connection not ready');
                    this.cleanup(guildId);
                    return;
                }
            }

            const tracks = await this.spotifyService.searchTracks(nextTrack.url);
            if (!tracks || tracks.length === 0) {
                throw new Error('Track not found');
            }

            const audioStream = await stream(tracks[0].external_urls.spotify);
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

            const nowPlayingEmbed = new EmbedBuilder()
                .setColor('#1DB954')
                .setTitle('Now Playing')
                .setDescription(`🎵 [${nextTrack.title}](${nextTrack.url})`)
                .addFields(
                    { name: 'Artist', value: `👤 ${nextTrack.artist || 'Unknown Artist'}`, inline: true },
                    { name: 'Duration', value: `⏱️ ${nextTrack.duration}`, inline: true },
                    { name: 'Requested By', value: `👥 ${nextTrack.requestedBy}`, inline: true }
                )
                .setThumbnail(nextTrack.thumbnail || 'https://i.imgur.com/IbS3k6R.png')
                .setFooter({ 
                    text: `Volume: ${Math.round(guildData.filters.volume * 100)}% | Bassboost: ${guildData.filters.bassboost ? 'On' : 'Off'}`,
                    iconURL: 'https://i.imgur.com/IbS3k6R.png'
                });

            await guildData.textChannel.send({ embeds: [nowPlayingEmbed] });

        } catch (error) {
            logger.error('Error processing queue:', error);
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Error')
                .setDescription('❌ Failed to play track. Skipping to next song...')
                .setTimestamp();
            await guildData.textChannel.send({ embeds: [errorEmbed] });
            guildData.currentItem = null;
            this.processQueue(guildId);
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

    public cleanup(guildId: string): void {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        if (guildData.connection) {
            guildData.connection.destroy();
        }

        if (guildData.timeout) {
            clearTimeout(guildData.timeout);
        }

        this.queues.delete(guildId);
    }

    public stop(guildId: string): void {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        guildData.queue = [];
        guildData.audioPlayer.stop(true);
        this.cleanup(guildId);
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
        guildData.audioPlayer.stop();
    }

    public setVolume(guildId: string, volume: number): boolean {
        const guildData = this.queues.get(guildId);
        if (!guildData) return false;

        volume = Math.max(0, Math.min(2, volume));
        guildData.filters.volume = volume;

        if (guildData.currentResource?.volume) {
            guildData.currentResource.volume.setVolume(volume);
            return true;
        }
        return false;
    }

    public toggleBassboost(guildId: string): boolean {
        const guildData = this.queues.get(guildId);
        if (!guildData) return false;

        guildData.filters.bassboost = !guildData.filters.bassboost;
        const volume = guildData.filters.bassboost 
            ? guildData.filters.volume * 1.5 
            : guildData.filters.volume;

        if (guildData.currentResource?.volume) {
            guildData.currentResource.volume.setVolume(volume);
        }

        return guildData.filters.bassboost;
    }

    public clearFilters(guildId: string): void {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        guildData.filters = {
            bassboost: false,
            volume: 1
        };

        if (guildData.currentResource?.volume) {
            guildData.currentResource.volume.setVolume(1);
        }
    }
}