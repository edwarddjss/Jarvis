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
import { TextChannel, NewsChannel, ThreadChannel, DMChannel, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { logger } from '../../config/logger.js';
import { VoiceStateManager, VoiceActivityType } from './voiceStateManager.js';
import { SpotifyService } from '../spotify/spotifyService.js';
import { stream, type SpotifyTrack } from 'play-dl';

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
                    noSubscriber: NoSubscriberBehavior.Play, // Continue playing even without subscribers
                }
            });
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

            // Set up audio player event handlers
            audioPlayer.on(AudioPlayerStatus.Idle, () => {
                logger.info(`Audio player idle in guild ${guildId}`);
                this.handleTrackEnd(guildId);
            });

            audioPlayer.on(AudioPlayerStatus.Playing, () => {
                logger.info(`Audio player playing in guild ${guildId}`);
            });

            audioPlayer.on(AudioPlayerStatus.Paused, () => {
                logger.info(`Audio player paused in guild ${guildId}`);
            });

            audioPlayer.on(AudioPlayerStatus.Buffering, () => {
                logger.info(`Audio player buffering in guild ${guildId}`);
            });

            audioPlayer.on(AudioPlayerStatus.AutoPaused, () => {
                logger.info(`Audio player auto-paused in guild ${guildId}`);
            });

            audioPlayer.on('error', (error) => {
                logger.error(error, `Audio player error in guild ${guildId}`);
                this.handleTrackEnd(guildId);
            });

            // Handle voice connection state changes
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                    // Seems to be reconnecting to a new channel - ignore disconnect
                } catch (error) {
                    // Only cleanup if not already destroyed
                    if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                        this.cleanup(guildId);
                    }
                }
            });

            connection.on(VoiceConnectionStatus.Destroyed, () => {
                // Only cleanup if we still have guild data
                if (this.queues.has(guildId)) {
                    this.cleanup(guildId);
                }
            });

            // Handle errors
            connection.on('error', error => {
                logger.error(error, `Voice connection error in guild ${guildId}`);
            });

            // Subscribe connection to audio player
            connection.subscribe(audioPlayer);
            logger.info(`Successfully subscribed connection to audio player in guild ${guildId}`);

            this.queues.set(guildId, guildData);
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
                    .setTitle('❌ No Results Found')
                    .setDescription('No tracks found matching your search query.')
                    .setTimestamp();
                await textChannel.send({ embeds: [embed] });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor('#1DB954')  // Spotify green
                .setTitle('🎵 Search Results')
                .setDescription('Select a track to play:')
                .setTimestamp();

            // Create buttons for each track
            const buttons = tracks.slice(0, 5).map((track, index) => {
                return new ButtonBuilder()
                    .setCustomId(`play_${index}`)
                    .setLabel(`${index + 1}. ${track.name} - ${track.artists[0].name}`)
                    .setStyle(ButtonStyle.Primary);
            });

            // Split buttons into rows (max 5 buttons per row)
            const rows = [];
            for (let i = 0; i < buttons.length; i += 5) {
                const row = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(buttons.slice(i, i + 5));
                rows.push(row);
            }

            const message = await textChannel.send({
                embeds: [embed],
                components: rows
            });

            // Create collector for button interactions
            const collector = message.createMessageComponentCollector({
                time: 30000 // 30 seconds timeout
            });

            collector.on('collect', async (interaction) => {
                if (!interaction.isButton()) return;

                const index = parseInt(interaction.customId.split('_')[1]);
                const selectedTrack = tracks[index];

                await interaction.deferUpdate();

                // Add the track to queue
                const queueItem: QueueItem = {
                    url: selectedTrack.external_urls.spotify,
                    title: selectedTrack.name,
                    requestedBy: requestedBy,
                    duration: this.spotifyService.formatTrackDuration(selectedTrack.duration_ms),
                    artist: selectedTrack.artists[0].name
                };

                const guildData = this.getOrCreateGuildData(guildId, connection, textChannel);
                guildData.queue.push(queueItem);

                if (!guildData.currentItem) {
                    await this.processQueue(guildId);
                } else {
                    const queuePosition = guildData.queue.length;
                    const addedEmbed = new EmbedBuilder()
                        .setColor('#1DB954')
                        .setTitle(queueItem.title)
                        .setDescription(`by ${queueItem.artist}`)
                        .setURL(queueItem.url)
                        .setAuthor({
                            name: '🎵 Added to Queue',
                            iconURL: 'https://i.imgur.com/IbS3k6R.png'
                        })
                        .addFields(
                            { name: 'Duration', value: queueItem.duration, inline: true },
                            { name: 'Requested By', value: queueItem.requestedBy, inline: true },
                            { name: 'Position in Queue', value: `#${queuePosition}`, inline: true }
                        )
                        .setTimestamp();

                    await textChannel.send({ embeds: [addedEmbed] });
                }

                collector.stop();
            });

            collector.on('end', () => {
                // Remove buttons after timeout or selection
                message.edit({ components: [] }).catch(error => 
                    logger.error(error, 'Failed to remove buttons after collector end')
                );
            });

        } catch (error) {
            logger.error(error, `Error searching tracks in guild ${guildId}`);
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Error')
                .setDescription(error instanceof Error ? error.message : 'An error occurred while searching for tracks.')
                .setTimestamp();
            await textChannel.send({ embeds: [errorEmbed] });
        }
    }

    public async addTrack(
        guildId: string,
        connection: VoiceConnection,
        textChannel: SendableChannel,
        url: string,
        requestedBy: string
    ): Promise<void> {
        const guildData = this.getOrCreateGuildData(guildId, connection, textChannel);
        
        try {
            const audioStream = await stream(url);
            const resource = createAudioResource(audioStream.stream, {
                inputType: audioStream.type
            });

            const queueItem: QueueItem = {
                url,
                title: 'title' in audioStream && typeof audioStream.title === 'string' 
                    ? audioStream.title 
                    : 'Unknown Title',
                requestedBy,
                duration: '0:00',
                thumbnail: undefined,
                artist: 'artists' in audioStream && Array.isArray(audioStream.artists) && audioStream.artists.length > 0 
                    ? String(audioStream.artists[0].name)
                    : 'Unknown Artist'
            };

            guildData.queue.push(queueItem);
            
            // If nothing is playing, start playing
            if (!guildData.currentItem) {
                await this.processQueue(guildId);
            }
        } catch (error) {
            logger.error('Error adding track:', error);
            throw new Error('Failed to add track to queue');
        }
    }

    private async processQueue(guildId: string): Promise<void> {
        const guildData = this.queues.get(guildId);
        if (!guildData || guildData.queue.length === 0) {
            logger.info(`No tracks in queue for guild ${guildId}`);
            this.startIdleTimeout(guildId);
            return;
        }

        try {
            const nextTrack = guildData.queue.shift()!;
            guildData.currentItem = nextTrack;
            logger.info(`Processing track: ${nextTrack.title} in guild ${guildId}`);

            // Check voice connection state
            if (guildData.connection.state.status === VoiceConnectionStatus.Disconnected) {
                try {
                    await Promise.race([
                        entersState(guildData.connection, VoiceConnectionStatus.Ready, 5_000),
                        entersState(guildData.connection, VoiceConnectionStatus.Signalling, 5_000),
                    ]);
                } catch (error) {
                    logger.error(error, `Failed to reconnect voice connection for guild ${guildId}`);
                    this.cleanup(guildId);
                    return;
                }
            }

            // Ensure connection is ready
            if (guildData.connection.state.status !== VoiceConnectionStatus.Ready) {
                try {
                    await entersState(guildData.connection, VoiceConnectionStatus.Ready, 5_000);
                } catch (error) {
                    logger.error(error, `Voice connection not ready for guild ${guildId}`);
                    this.cleanup(guildId);
                    return;
                }
            }

            logger.info(`Starting stream for URL: ${nextTrack.url}`);
            const audioStream = await stream(nextTrack.url);
            logger.info('Stream created successfully');

            logger.info('Creating audio resource');
            guildData.currentResource = createAudioResource(audioStream.stream, {
                inputType: audioStream.type,
                inlineVolume: true,
                silencePaddingFrames: 5
            });
            logger.info('Audio resource created');

            if (guildData.currentResource.volume) {
                const volume = guildData.filters.bassboost 
                    ? guildData.filters.volume * 1.5 
                    : guildData.filters.volume;
                guildData.currentResource.volume.setVolume(volume);
                logger.info(`Set volume to ${volume}`);
            }

            logger.info('Starting playback');
            
            // Set up a promise to detect when we enter Playing state
            const playingPromise = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('Timed out waiting for audio to start playing'));
                }, 10_000); // 10 second timeout

                const cleanup = () => {
                    clearTimeout(timeout);
                    guildData.audioPlayer.removeListener(AudioPlayerStatus.Playing, onPlaying);
                    guildData.audioPlayer.removeListener('error', onError);
                };

                const onPlaying = () => {
                    cleanup();
                    resolve();
                };

                const onError = (error: Error) => {
                    cleanup();
                    reject(error);
                };

                guildData.audioPlayer.once(AudioPlayerStatus.Playing, onPlaying);
                guildData.audioPlayer.once('error', onError);
            });

            try {
                guildData.audioPlayer.play(guildData.currentResource);
                await playingPromise;
                logger.info('Successfully started playback');
            } catch (error) {
                logger.error(error, 'Failed to start playback');
                throw error;
            }

            // Create rich embed for now playing message
            const embed = new EmbedBuilder()
                .setColor('#1DB954')  // Spotify green
                .setTitle(nextTrack.title)
                .setDescription(`by ${nextTrack.artist}`)
                .setURL(nextTrack.url)
                .setAuthor({
                    name: '🎵 Now Playing',
                    iconURL: 'https://i.imgur.com/IbS3k6R.png'
                })
                .addFields(
                    { name: 'Duration', value: nextTrack.duration, inline: true },
                    { name: 'Requested By', value: nextTrack.requestedBy, inline: true }
                )
                .setTimestamp()
                .setFooter({ 
                    text: `Volume: ${guildData.filters.volume * 100}% | Bassboost: ${guildData.filters.bassboost ? 'On' : 'Off'}`,
                    iconURL: 'https://i.imgur.com/IbS3k6R.png'
                });

            if (guildData.timeout) {
                clearTimeout(guildData.timeout);
                guildData.timeout = null;
            }

            await guildData.textChannel.send({ embeds: [embed] });
        } catch (error) {
            logger.error(error, `Error processing queue in guild ${guildId}`);
            try {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('❌ Error Playing Track')
                    .setDescription('An error occurred while playing the track. Skipping to next song...')
                    .setTimestamp();
                await guildData.textChannel.send({ embeds: [errorEmbed] });
            } catch (sendError) {
                logger.error(sendError, 'Failed to send error message to channel');
            }
            this.handleTrackEnd(guildId);
        }
    }

    private handleTrackEnd(guildId: string): void {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        // Clear the current track
        guildData.currentResource = null;
        guildData.currentItem = null;

        if (guildData.queue.length > 0) {
            // Play next track if queue is not empty
            this.processQueue(guildId);
        } else {
            // Clear the music state if no more tracks
            this.stateManager.clearState(guildId);
            
            // Start disconnect timeout
            if (guildData.timeout) clearTimeout(guildData.timeout);
            guildData.timeout = setTimeout(() => this.cleanup(guildId), this.IDLE_TIMEOUT);
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

        try {
            // Stop audio player first
            if (guildData.audioPlayer) {
                guildData.audioPlayer.stop(true);
            }

            // Clear the queue
            guildData.queue = [];
            guildData.currentItem = null;
            guildData.currentResource = null;

            // Clear the timeout if it exists
            if (guildData.timeout) {
                clearTimeout(guildData.timeout);
                guildData.timeout = null;
            }

            // Only destroy connection if it hasn't been destroyed yet
            if (guildData.connection && guildData.connection.state.status !== VoiceConnectionStatus.Destroyed) {
                guildData.connection.destroy();
            }

            // Remove from queue map
            this.queues.delete(guildId);
            
            logger.info(`Cleaned up resources for guild ${guildId}`);
        } catch (error) {
            logger.error(error, `Error during cleanup for guild ${guildId}`);
        }
    }

    public stop(guildId: string): void {
        const guildData = this.queues.get(guildId);
        if (!guildData) return;

        logger.info(`Stopping music playback in guild ${guildId}`);
        guildData.queue = [];
        guildData.audioPlayer.stop(true);
        guildData.currentItem = null;
        guildData.currentResource = null;
        
        // Clear the music state
        this.stateManager.clearState(guildId);
        logger.info(`Cleared music state for guild ${guildId}`);
        
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