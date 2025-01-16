// src/commands/stop.ts
import { 
    ChatInputCommandInteraction, 
    GuildMember, 
    SlashCommandBuilder 
} from 'discord.js';
import { logger } from '../config/logger.js';
import { Command } from '../types';
import { MusicHandler } from '../api/discord/musicHandler.js';

const data = new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playing music');

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
            musicHandler.stop(interaction.guildId!);

            await interaction.editReply({
                content: '⏹️ Stopped playing music'
            });
        } catch (error) {
            logger.error(error, 'Error in stop command');
            await interaction.editReply({
                content: '❌ An error occurred while stopping the music.'
            });
        }
    }
};

export default command;