// src/api/discord/musicHandler.ts
import { 
    AudioPlayer, 
    AudioPlayerStatus, 
    AudioResource, 
    VoiceConnection, 
    VoiceConnectionStatus, 
    createAudioPlayer, 
    createAudioResource, 
    entersState,
    NoSubscriberBehavior,
    StreamType
} from '@discordjs/voice';
import { TextChannel, NewsChannel, ThreadChannel, DMChannel, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, ButtonInteraction } from 'discord.js';
import { logger } from '../../config/logger.js';
import { VoiceStateManager } from './voiceStateManager.js';
import { YouTubeService, YouTubeTrack } from '../youtube/youtubeService.js';

type SendableChannel = TextChannel | NewsChannel | ThreadChannel | DMChannel;

interface QueueItem extends YouTubeTrack {
    requestedBy: string;
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
    private youtubeService: YouTubeService;

    private constructor() {
        this.queues = new Map();
        this.stateManager = VoiceStateManager.getInstance();
        this.youtubeService = YouTubeService.getInstance();
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
            
            // Subscribe the connection to the audio player
            const subscription = connection.subscribe(audioPlayer);
            if (!subscription) {
                logger.error(`Failed to subscribe connection to audio player in guild ${guildId}`);
                throw new Error('Failed to subscribe to audio player');
            }
            logger.info(`Successfully subscribed connection to audio player in guild ${guildId}`);

            // Add audio player event listeners
            audioPlayer.on(AudioPlayerStatus.Idle, () => {
                logger.info(`Audio player went idle in guild ${guildId}`);
                this.handleTrackEnd(guildId);
            });

            audioPlayer.on(AudioPlayerStatus.Playing, () => {
                logger.info(`Started playing in guild ${guildId}`);
            });

            audioPlayer.on(AudioPlayerStatus.Buffering, () => {
                logger.info(`Buffering in guild ${guildId}`);
            });

            audioPlayer.on('error', error => {
                logger.error(error, `Error in audio player for guild ${guildId}`);
                this.handleTrackEnd(guildId);
            });

            // Add voice connection event listeners
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    logger.info(`Attempting to reconnect in guild ${guildId}`);
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                } catch (error) {
                    logger.error(`Failed to reconnect, cleaning up`);
                    this.cleanup(guildId);
                }
            });

            connection.on(VoiceConnectionStatus.Ready, () => {
                logger.info(`Voice connection ready in guild ${guildId}`);
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
            const tracks = await this.youtubeService.searchTracks(query);
            
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
                .setColor('#FF0000')
                .setTitle('Search Results')
                .setDescription(`🔍 Results for: "${query}"`)
                .addFields(
                    tracks.map((track, index) => ({
                        name: `${index + 1}. ${track.title}`,
                        value: `👤 ${track.author.name}\n⏱️ ${track.duration}`
                    }))
                )
                .setThumbnail(tracks[0].thumbnail)
                .setFooter({ text: 'Select a track within 30 seconds' });

            const buttons = tracks.map((_, index) => {
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
                    ...selectedTrack,
                    requestedBy
                };

                guildData.queue.push(queueItem);

                const addedEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle(queueItem.title)
                    .setURL(queueItem.url)
                    .setDescription(`Added to queue by ${requestedBy}`)
                    .addFields(
                        { name: 'Channel', value: queueItem.author.name, inline: true },
                        { name: 'Duration', value: queueItem.duration, inline: true },
                        { name: 'Position', value: `#${guildData.queue.length}`, inline: true }
                    )
                    .setThumbnail(queueItem.thumbnail)
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

    public async addTrack(
        guildId: string,
        connection: VoiceConnection,
        textChannel: SendableChannel,
        url: string,
        requestedBy: string
    ): Promise<void> {
        try {
            const tracks = await this.youtubeService.searchTracks(url);
            if (!tracks || tracks.length === 0) {
                throw new Error('Track not found');
            }

            const guildData = this.getOrCreateGuildData(guildId, connection, textChannel);
            const queueItem: QueueItem = {
                ...tracks[0],
                requestedBy
            };

            guildData.queue.push(queueItem);

            const addedEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(queueItem.title)
                .setURL(queueItem.url)
                .setDescription(`Added to queue by ${requestedBy}`)
                .addFields(
                    { name: 'Channel', value: queueItem.author.name, inline: true },
                    { name: 'Duration', value: queueItem.duration, inline: true },
                    { name: 'Position', value: `#${guildData.queue.length}`, inline: true }
                )
                .setThumbnail(queueItem.thumbnail)
                .setTimestamp();

            await textChannel.send({ embeds: [addedEmbed] });

            if (!guildData.currentItem) {
                await this.processQueue(guildId);
            }
        } catch (error) {
            logger.error('Error adding track:', error);
            throw error;
        }
    }

    private async processQueue(guildId: string): Promise<void> {
        const guildData = this.queues.get(guildId);
        if (!guildData) {
            logger.error(`No guild data found for guild ${guildId}`);
            return;
        }

        if (guildData.timeout) {
            clearTimeout(guildData.timeout);
            guildData.timeout = null;
        }

        if (guildData.queue.length === 0) {
            logger.info(`Queue is empty for guild ${guildId}`);
            this.startIdleTimeout(guildId);
            return;
        }

        const nextTrack = guildData.queue.shift()!;
        guildData.currentItem = nextTrack;

        try {
            // Check voice connection
            if (guildData.connection.state.status === VoiceConnectionStatus.Disconnected) {
                logger.info(`Attempting to reconnect voice in guild ${guildId}`);
                try {
                    await Promise.race([
                        entersState(guildData.connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(guildData.connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                } catch (error) {
                    logger.error(`Failed to reconnect, cleaning up guild ${guildId}`);
                    this.cleanup(guildId);
                    return;
                }
            }

            // Wait for Ready state
            if (guildData.connection.state.status !== VoiceConnectionStatus.Ready) {
                try {
                    logger.info(`Waiting for voice connection to be ready in guild ${guildId}`);
                    await entersState(guildData.connection, VoiceConnectionStatus.Ready, 5_000);
                } catch (error) {
                    logger.error(`Voice connection failed to become ready in guild ${guildId}`);
                    this.cleanup(guildId);
                    return;
                }
            }

            // Create a new audio player if needed
            if (!guildData.audioPlayer) {
                guildData.audioPlayer = createAudioPlayer({
                    behaviors: {
                        noSubscriber: NoSubscriberBehavior.Play,
                        maxMissedFrames: 50
                    }
                });

                // Set up audio player event handlers
                guildData.audioPlayer.on('stateChange', (oldState, newState) => {
                    logger.info(`Audio player state changed in guild ${guildId}: ${oldState.status} -> ${newState.status}`);
                });

                guildData.audioPlayer.on('error', error => {
                    logger.error(`Error in audio player for guild ${guildId}:`, error);
                });
            }

            // Subscribe the connection to the audio player
            const subscription = guildData.connection.subscribe(guildData.audioPlayer);
            if (!subscription) {
                throw new Error('Failed to subscribe to audio player');
            }
            logger.info(`Successfully subscribed connection to audio player in guild ${guildId}`);

            try {
                // Get the stream
                logger.info(`Getting stream for track ${nextTrack.title} in guild ${guildId}`);
                const stream = await this.youtubeService.getStream(nextTrack.url);
                
                if (!stream || !stream.stream) {
                    throw new Error('Failed to get valid stream');
                }

                // Create the audio resource
                logger.info(`Creating audio resource for track ${nextTrack.title} in guild ${guildId}`);
                guildData.currentResource = createAudioResource(stream.stream, {
                    inputType: stream.type,
                    inlineVolume: true,
                    silencePaddingFrames: 5
                });

                if (!guildData.currentResource) {
                    throw new Error('Failed to create audio resource');
                }

                // Add resource event handlers
                guildData.currentResource.playStream
                    .on('error', error => {
                        logger.error(`Stream error in guild ${guildId}:`, error);
                    })
                    .on('end', () => {
                        logger.info(`Stream ended in guild ${guildId}`);
                    })
                    .on('close', () => {
                        logger.info(`Stream closed in guild ${guildId}`);
                    });

                // Set volume if needed
                if (guildData.currentResource.volume) {
                    guildData.currentResource.volume.setVolume(guildData.filters.volume);
                }

                // Play the track
                logger.info(`Playing track ${nextTrack.title} in guild ${guildId}`);
                guildData.audioPlayer.play(guildData.currentResource);

                // Wait for the player to start playing
                logger.info(`Waiting for player to start in guild ${guildId}`);
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Timed out waiting for playback to start'));
                    }, 15000);

                    const onStateChange = (oldState: any, newState: any) => {
                        logger.info(`Player state changed in guild ${guildId}: ${oldState.status} -> ${newState.status}`);
                        
                        if (newState.status === AudioPlayerStatus.Playing) {
                            clearTimeout(timeout);
                            guildData.audioPlayer.off('stateChange', onStateChange);
                            resolve(true);
                        } else if (newState.status === AudioPlayerStatus.Idle) {
                            clearTimeout(timeout);
                            guildData.audioPlayer.off('stateChange', onStateChange);
                            reject(new Error('Player entered Idle state before Playing'));
                        }
                    };

                    // Also listen for errors
                    const onError = (error: any) => {
                        logger.error(`Player error in guild ${guildId}:`, error);
                        clearTimeout(timeout);
                        guildData.audioPlayer.off('stateChange', onStateChange);
                        guildData.audioPlayer.off('error', onError);
                        reject(new Error('Audio player encountered an error'));
                    };

                    guildData.audioPlayer.on('stateChange', onStateChange);
                    guildData.audioPlayer.on('error', onError);

                    // Check current state
                    const currentState = guildData.audioPlayer.state.status;
                    logger.info(`Current player state in guild ${guildId}: ${currentState}`);
                });

                logger.info(`Successfully started playing ${nextTrack.title} in guild ${guildId}`);

                const playingEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('Now Playing')
                    .setDescription(`🎵 **${nextTrack.title}**`)
                    .addFields(
                        { name: 'Channel', value: nextTrack.author.name, inline: true },
                        { name: 'Duration', value: nextTrack.duration, inline: true },
                        { name: 'Requested by', value: nextTrack.requestedBy, inline: true }
                    )
                    .setThumbnail(nextTrack.thumbnail)
                    .setTimestamp();

                await guildData.textChannel.send({ embeds: [playingEmbed] });

            } catch (error) {
                logger.error('Error playing track:', error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                const errorEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('Error')
                    .setDescription(`❌ Failed to play this track: ${errorMessage}. Skipping to next song...`)
                    .setTimestamp();
                await guildData.textChannel.send({ embeds: [errorEmbed] });
                this.handleTrackEnd(guildId);
                return;
            }
        } catch (error) {
            logger.error('Error processing queue:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Error')
                .setDescription(`❌ Failed to play track: ${errorMessage}. Skipping to next song...`)
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