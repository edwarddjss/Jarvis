// src/commands/bassboost.ts
import { 
    ChatInputCommandInteraction, 
    GuildMember, 
    SlashCommandBuilder 
} from 'discord.js';
import { logger } from '../config/logger.js';
import { Command } from '../types';
import { MusicHandler } from '../api/discord/musicHandler.js';

const data = new SlashCommandBuilder()
    .setName('bassboost')
    .setDescription('Toggle bassboost filter');

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
            const enabled = musicHandler.toggleBassboost(interaction.guildId!);

            await interaction.editReply({
                content: `🎵 Bassboost ${enabled ? 'enabled' : 'disabled'}`
            });
        } catch (error) {
            logger.error(error, 'Error in bassboost command');
            await interaction.editReply({
                content: '❌ An error occurred while toggling bassboost.'
            });
        }
    }
};

export default command;