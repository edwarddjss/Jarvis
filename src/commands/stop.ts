// src/commands/stop.ts
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
    .setName('stop')
    .setDescription('Stop the current playback');

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
        musicHandler.stop(interaction.guildId!);

        await interaction.reply({
            content: '⏹️ Playback has been stopped.',
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        logger.error(error, 'Error in stop command');
        await interaction.reply({
            content: 'An error occurred while stopping the playback.',
            flags: MessageFlags.Ephemeral
        });
    }
}