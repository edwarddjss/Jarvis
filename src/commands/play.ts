// src/commands/play.ts
import { 
    CommandInteraction, 
    GuildMember,
    TextChannel,
    NewsChannel,
    ThreadChannel,
    SlashCommandBuilder,
    MessageFlags
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
            await interaction.reply({
                content: 'You must be in a voice channel to use this command!',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const channel = interaction.channel;
        if (!channel || !(channel instanceof TextChannel || channel instanceof ThreadChannel || channel instanceof NewsChannel)) {
            await interaction.reply({
                content: 'This command can only be used in text channels.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const url = interaction.options.get('url')?.value as string;
        const connectionHandler = new VoiceConnectionHandler(interaction);
        const connection = await connectionHandler.connect();

        if (!connection) {
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

        await interaction.reply({
            content: '🎵 Added track to queue',
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        logger.error(error, 'Error in play command');
        await interaction.reply({
            content: 'An error occurred while playing the audio.',
            flags: MessageFlags.Ephemeral
        });
    }
}