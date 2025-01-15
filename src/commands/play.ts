// src/commands/play.ts
import { 
    CommandInteraction, 
    GuildMember,
    TextChannel,
    NewsChannel,
    ThreadChannel,
    SlashCommandBuilder
} from 'discord.js';
import { VoiceConnectionHandler } from '../api/discord/voiceConnection.js';
import { logger } from '../config/logger.js';
import { Embeds } from '../utils/index.js';
import { MusicHandler } from '../api/discord/musicHandler.js';

export const data = new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music from YouTube')
    .addStringOption(option =>
        option
            .setName('url')
            .setDescription('The YouTube URL to play')
            .setRequired(true)
    );

export async function execute(interaction: CommandInteraction): Promise<void> {
    try {
        const member = interaction.member as GuildMember;
        
        if (!member?.voice?.channel) {
            await interaction.editReply({
                content: 'You must be in a voice channel to use this command!'
            });
            return;
        }

        const channel = interaction.channel;
        if (!channel || !(channel instanceof TextChannel || channel instanceof ThreadChannel || channel instanceof NewsChannel)) {
            await interaction.editReply({
                content: 'This command can only be used in text channels.'
            });
            return;
        }

        const url = interaction.options.get('url')?.value as string;
        const connectionHandler = new VoiceConnectionHandler(interaction, true); // Set isForMusic to true
        const connection = await connectionHandler.connect();

        if (!connection) {
            await interaction.editReply({
                content: 'Failed to establish voice connection.'
            });
            return;
        }

        const musicHandler = MusicHandler.getInstance();
        await musicHandler.addTrack(
            interaction.guildId!,
            connection,
            channel,
            url,
            member.user.tag
        );

        await interaction.editReply({
            content: '🎵 Added track to queue'
        });
    } catch (error) {
        logger.error(error, 'Error in play command');
        await interaction.editReply({
            content: 'An error occurred while playing the audio.'
        });
    }
}