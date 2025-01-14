import { Client, Collection } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Command } from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function loadCommands(client: Client) {
  client.commands = new Collection<string, Command>();
  const commandsPath = join(__dirname, '../commands');
  const commandFiles = readdirSync(commandsPath).filter(file =>
    file.endsWith('.ts') || file.endsWith('.js')
  );

  for (const file of commandFiles) {
    const filePath = join(commandsPath, file);

    try {
      const commandModule = await import(filePath);
      console.log(`Loaded command: ${file}`);
      console.log(commandModule);

      if ('data' in commandModule && 'execute' in commandModule) {
        client.commands.set(commandModule.data.name, commandModule as Command);
      } else {
        console.error(`Invalid command structure in file: ${file}`);
      }
    } catch (error) {
      console.error(`Error loading command from file: ${file}`);
      console.error(error);
    }
  }
}