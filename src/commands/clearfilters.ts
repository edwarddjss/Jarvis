// src/commands/clearfilters.ts
import { 
    ChatInputCommandInteraction, 
    GuildMember, 
    SlashCommandBuilder 
} from 'discord.js';
import { logger } from '../config/logger.js';
import { Command } from '../types';
import { MusicHandler } from '../api/discord/musicHandler.js';

const data = new SlashCommandBuilder()
    .setName('clearfilters')
    .setDescription('Clear all audio filters');

const command: Command = {
    data: data.toJSON(),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply();
        
        try {
            const member = interaction.member as GuildMember;
            
            if (!member?.voice?.channel) {
                await interaction.editReply({
                    content: '❌ You must be in a voice channel to use this command!'
                });
                return;
            }

            const musicHandler = MusicHandler.getInstance();
            musicHandler.clearFilters(interaction.guildId!);

            await interaction.editReply({
                content: '🎵 All audio filters have been cleared'
            });
        } catch (error) {
            logger.error(error, 'Error in clearfilters command');
            await interaction.editReply({
                content: '❌ An error occurred while clearing filters.'
            });
        }
    }
};

export default command;