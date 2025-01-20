import { 
    ChatInputCommandInteraction,
    GuildMember,
    SlashCommandBuilder
} from 'discord.js';
import { logger } from '../config/logger.js';
import { Command } from '../types';
import { VoiceConnectionHandler } from '../api/discord/voiceConnection.js';
import { VoiceStateManager, VoiceActivityType } from '../api/discord/voiceStateManager.js';

const data = new SlashCommandBuilder()
    .setName('talk')
    .setDescription('Join a voice channel');

const command: Command = {
    data: data.toJSON(),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const member = interaction.member as GuildMember;
            const stateManager = VoiceStateManager.getInstance();
            
            if (!member?.voice?.channel) {
                await interaction.editReply({
                    content: '❌ You must be in a voice channel to use this command!'
                });
                return;
            }

            // Check if music is playing
            if (stateManager.isPlayingMusic(interaction.guildId!)) {
                await interaction.editReply({
                    content: '❌ Cannot start voice chat while music is playing. Please stop the music first.'
                });
                return;
            }

            // Check if already in speech mode
            if (stateManager.isSpeaking(interaction.guildId!)) {
                await interaction.editReply({
                    content: '❌ Already in voice chat mode. Use /leave to exit first.'
                });
                return;
            }

            const connectionHandler = new VoiceConnectionHandler(interaction, false);
            const connection = await connectionHandler.connect();

            if (!connection) {
                await interaction.editReply({
                    content: '❌ Failed to join voice channel.'
                });
                return;
            }

            // Set voice state to speech mode
            stateManager.setVoiceState(interaction.guildId!, VoiceActivityType.SPEECH);

            // Connection successful, VoiceConnectionHandler will handle the success message
        } catch (error) {
            logger.error(error, 'Error in talk command');
            await interaction.editReply({
                content: '❌ An error occurred while joining the channel.'
            });
        }
    }
};

export default command;
