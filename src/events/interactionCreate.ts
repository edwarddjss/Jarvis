import { Events, Interaction, ChatInputCommandInteraction } from 'discord.js';

export const name = Events.InteractionCreate;
export async function execute(interaction: Interaction) {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    // Only defer if it hasn't been deferred already
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
    
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    
    // Check if already replied
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        content: 'There was an error executing this command!'
      });
    } else {
      await interaction.reply({
        content: 'There was an error executing this command!',
        ephemeral: true
      });
    }
  }
}