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
            const command = commandModule.default;

            if (!command?.data || !command?.execute) {
                console.error(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
                continue;
            }

            client.commands.set(command.data.name, command);
            console.log(`✅ Successfully loaded command: ${command.data.name}`);
        } catch (error) {
            console.error(`❌ Error loading command from file: ${file}`);
            console.error(error);
        }
    }
}