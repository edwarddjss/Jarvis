// src/commands/clearfilters.ts
import { 
    CommandInteraction, 
    GuildMember, 
    SlashCommandBuilder, 
    MessageFlags 
} from 'discord.js';
import { logger } from '../config/logger.js';
import { Embeds } from '../utils/index.js';
import { MusicHandler } from '../api/discord/musicHandler.js';

export const data = new SlashCommandBuilder()
    .setName('clearfilters')
    .setDescription('Clear all audio filters');

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

        const musicHandler = MusicHandler.getInstance();
        musicHandler.clearFilters(interaction.guildId!);

        await interaction.reply({
            content: '🎵 All audio filters have been cleared',
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        logger.error(error, 'Error in clearfilters command');
        await interaction.reply({
            content: 'An error occurred while clearing filters.',
            flags: MessageFlags.Ephemeral
        });
    }
}