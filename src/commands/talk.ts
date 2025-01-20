import { 
    ChatInputCommandInteraction,
    GuildMember,
    SlashCommandBuilder
} from 'discord.js';
import { logger } from '../config/logger.js';
import { Command } from '../types';
import { VoiceConnectionHandler } from '../api/discord/voiceConnection.js';

const data = new SlashCommandBuilder()
    .setName('talk')
    .setDescription('Join a voice channel');

const command: Command = {
    data: data.toJSON(),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const member = interaction.member as GuildMember;
            
            if (!member?.voice?.channel) {
                await interaction.editReply({
                    content: '❌ You must be in a voice channel to use this command!'
                });
                return;
            }

            const connectionHandler = new VoiceConnectionHandler(interaction);
            const connection = await connectionHandler.connect();

            if (!connection) {
                await interaction.editReply({
                    content: '❌ Failed to join voice channel.'
                });
                return;
            }

            await interaction.editReply({
                content: '🎤 Joined your voice channel!'
            });
        } catch (error) {
            logger.error(error, 'Error in talk command');
            await interaction.editReply({
                content: '❌ An error occurred while joining the channel.'
            });
        }
    }
};

export default command;
