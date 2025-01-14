import { Client, Events } from 'discord.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client: Client) {
    console.log(`Ready! Logged in as ${client.user?.tag}`);
    
    // Register slash commands
    const commands = Array.from(client.commands.values()).map(cmd => cmd.data);
    
    client.application?.commands.set(commands)
      .then(() => console.log('Slash commands registered globally'))
      .catch(console.error);
  }
};