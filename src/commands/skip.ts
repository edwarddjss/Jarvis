import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { MusicHandler } from '../api/discord/musicHandler.js';
import { Command } from '../types.js';
import { logger } from '../config/logger.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song')
        .toJSON(),
    execute: async (interaction: ChatInputCommandInteraction) => {
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

            const musicHandler = MusicHandler.getInstance();
            musicHandler.skip(interaction.guildId!);
            await interaction.editReply('⏭️ Skipped to the next song!');
        } catch (error) {
            logger.error('Error in skip command:', error);
            await interaction.editReply({
                content: '❌ Failed to skip the current song.'
            });
        }
    }
};

export default command;
