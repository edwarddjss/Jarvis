import { 
    ChatInputCommandInteraction, 
    GuildMember, 
    SlashCommandBuilder 
} from 'discord.js';
import { logger } from '../config/logger.js';
import { Command } from '../types';
import { MusicHandler } from '../api/discord/musicHandler.js';
import { VoiceStateManager } from '../api/discord/voiceStateManager.js';

const data = new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the voice channel');

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

            // Stop music if it's playing
            const musicHandler = MusicHandler.getInstance();
            musicHandler.stop(interaction.guildId!);

            // Clear voice state
            stateManager.clearState(interaction.guildId!);

            await interaction.editReply({
                content: '👋 Left the voice channel!'
            });
        } catch (error) {
            logger.error(error, 'Error in leave command');
            await interaction.editReply({
                content: '❌ An error occurred while leaving the channel.'
            });
        }
    }
};

export default command;
