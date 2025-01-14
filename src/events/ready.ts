import { Client, Events } from 'discord.js';

export const name = Events.ClientReady;
export const once = true;
export function execute(client: Client) {
  console.log(`Ready! Logged in as ${client.user?.tag}`);
  
  // Register slash commands
  const commands = Array.from(client.commands.values()).map(cmd => cmd.data);
  
  client.application?.commands.set(commands)
    .then(() => console.log('Slash commands registered globally'))
    .catch(console.error);
}