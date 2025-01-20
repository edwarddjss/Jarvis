import { 
    ChatInputCommandInteraction,
    SlashCommandBuilder
} from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { Command } from '../types';
import { VoiceStateManager } from '../api/discord/voiceStateManager.js';
import { logger } from '../config/logger.js';

const data = new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the voice channel');

const command: Command = {
    data: data.toJSON(),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const connection = getVoiceConnection(interaction.guildId!);
            const stateManager = VoiceStateManager.getInstance();

            if (!connection) {
                await interaction.reply({
                    content: '❌ I am not in a voice channel.',
                    ephemeral: true
                });
                return;
            }

            // Properly destroy the connection
            connection.destroy();

            // Clear voice state
            stateManager.clearState(interaction.guildId!);

            await interaction.reply({
                content: '👋 Left the voice channel!',
                ephemeral: true
            });

            logger.info(`Left voice channel in guild ${interaction.guildId}`);
        } catch (error) {
            logger.error(error, 'Error in leave command');
            await interaction.reply({
                content: '❌ An error occurred while leaving the channel.',
                ephemeral: true
            });
        }
    }
};

export default command;
