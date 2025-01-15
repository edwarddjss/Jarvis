import { AudioPlayer } from '@discordjs/voice';
import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { SpeechHandler } from '../api/discord/speech.js';
import { ElevenLabsConversationalAI } from '../api/elevenlabs/conversationalClient.js';
import { VoiceConnectionHandler } from '../api/index.js';
import { logger } from '../config/logger.js';
import { Embeds } from '../utils/index.js';

export const data = new SlashCommandBuilder()
  .setName('talk')
  .setDescription('Unleash an auditory adventure with a voice that echoes from the digital realm.');

/**
 * Executes the talk command.
 *
 * @param {CommandInteraction} interaction - The interaction object representing the command execution.
 * @returns {Promise<void>}
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const audioPlayer = new AudioPlayer();
    const elevenlabsConvClient = new ElevenLabsConversationalAI(audioPlayer);
    const connectionHandler = new VoiceConnectionHandler(interaction);

    const connection = await connectionHandler.connect();
    if (!connection) {
      return;
    }

    connection.subscribe(audioPlayer);

    const speechHandler = new SpeechHandler(
      elevenlabsConvClient, 
      connection,
      interaction.guildId!
    );
    speechHandler.initialize();
  } catch (error) {
    logger.error(error, 'Something went wrong during voice mode');

    await interaction.reply({
      embeds: [Embeds.error('Error', 'An error occurred while starting the voice chat.')],
      ephemeral: true,
    });
  }
}
