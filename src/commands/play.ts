// src/commands/play.ts
import { 
    ChatInputCommandInteraction,
    GuildMember,
    TextChannel,
    NewsChannel,
    ThreadChannel,
    SlashCommandBuilder,
    SlashCommandStringOption
} from 'discord.js';
import { VoiceConnectionHandler } from '../api/discord/voiceConnection.js';
import { logger } from '../config/logger.js';
import { MusicHandler } from '../api/discord/musicHandler.js';
import { Command } from '../types';

const data = new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music from YouTube')
    .addStringOption((option: SlashCommandStringOption) => 
        option
            .setName('query')
            .setDescription('Enter a song name, artist, or YouTube URL')
            .setRequired(true)
            .setAutocomplete(true)
    );

const command: Command = {
    data: data.toJSON(),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply();
        }

        try {
            const member = interaction.member as GuildMember;
            
            if (!member?.voice?.channel) {
                await interaction.editReply({
                    content: '❌ You must be in a voice channel to use this command!'
                });
                return;
            }

            const channel = interaction.channel;
            if (!channel || !(channel instanceof TextChannel || channel instanceof ThreadChannel || channel instanceof NewsChannel)) {
                await interaction.editReply({
                    content: '❌ This command can only be used in text channels.'
                });
                return;
            }

            const query = interaction.options.getString('query', true);
            const connectionHandler = new VoiceConnectionHandler(interaction, true);
            const connection = await connectionHandler.connect();

            if (!connection) {
                await interaction.editReply({
                    content: '❌ Failed to join voice channel.'
                });
                return;
            }

            const musicHandler = MusicHandler.getInstance();

            // Check if the input is a YouTube URL
            const isYoutubeUrl = query.match(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/);
            
            try {
                if (isYoutubeUrl) {
                    await interaction.editReply({
                        content: '🎵 Adding track to queue...'
                    });
                    await musicHandler.addTrack(
                        interaction.guildId!,
                        connection,
                        channel,
                        query,
                        member.user.username
                    );
                } else {
                    await interaction.editReply({
                        content: '🔍 Searching YouTube...'
                    });
                    await musicHandler.searchAndShowResults(
                        interaction.guildId!,
                        connection,
                        channel,
                        query,
                        member.user.username
                    );
                }
            } catch (error) {
                logger.error('Error in music handler:', error);
                await interaction.editReply({
                    content: '❌ Failed to process music request. Please try again.'
                });
            }
        } catch (error) {
            logger.error('Error in play command:', error);
            if (!interaction.replied) {
                await interaction.editReply({
                    content: '❌ An error occurred while processing your request.'
                });
            }
        }
    }
};

export default command;