// src/commands/bassboost.ts
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
    .setName('bassboost')
    .setDescription('Toggle bassboost filter');

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
        const enabled = musicHandler.toggleBassboost(interaction.guildId!);

        await interaction.reply({
            content: `🎵 Bass boost has been ${enabled ? 'enabled' : 'disabled'}`,
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        logger.error(error, 'Error in bassboost command');
        await interaction.reply({
            content: 'An error occurred while toggling bass boost.',
            flags: MessageFlags.Ephemeral
        });
    }
}