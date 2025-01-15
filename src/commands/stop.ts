// src/commands/stop.ts
import { CommandInteraction, GuildMember, SlashCommandBuilder } from 'discord.js';
import { logger } from '../config/logger.js';
import { Embeds } from '../utils/index.js';
import { MusicHandler } from '../api/discord/musicHandler.js';

export const data = new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop the current playback');

export async function execute(interaction: CommandInteraction): Promise<void> {
    try {
        await interaction.deferReply();
        const member = interaction.member as GuildMember;

        if (!member?.voice?.channel) {
            await interaction.editReply({
                embeds: [Embeds.error('Voice Channel Required', 'You must be in a voice channel to use this command!')],
            });
            return;
        }

        const musicHandler = MusicHandler.getInstance();
        musicHandler.stop(interaction.guildId!);

        await interaction.editReply({
            embeds: [Embeds.success('Stopped', '⏹️ Playback has been stopped.')],
        });
    } catch (error) {
        logger.error(error, 'Error in stop command');
        await interaction.editReply({
            embeds: [Embeds.error('Error', 'An error occurred while stopping the playback.')],
        });
    }
}