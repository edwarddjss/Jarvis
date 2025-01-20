import { Events, Interaction, ChatInputCommandInteraction, InteractionReplyOptions } from 'discord.js';

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
      await interaction.deferReply({ flags: ['Ephemeral'] });
    }
    
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    
    const errorResponse: InteractionReplyOptions = {
      content: 'There was an error executing this command!',
      flags: ['Ephemeral']
    };

    // Check if already replied
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(errorResponse);
    } else {
      await interaction.reply(errorResponse);
    }
  }
}