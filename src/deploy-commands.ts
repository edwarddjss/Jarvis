import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DISCORD_CONFIG } from './config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const commands = [];
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter(file => 
    file.endsWith('.ts') || file.endsWith('.js')
);

for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const command = await import(filePath);
    
    if ('data' in command.default && 'execute' in command.default) {
        commands.push(command.default.data);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(DISCORD_CONFIG.DISCORD_BOT_TOKEN);

// Deploy commands globally
try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    // Register commands globally using CLIENT_ID
    const data = await rest.put(
        Routes.applicationCommands(DISCORD_CONFIG.CLIENT_ID),
        { body: commands },
    );

    console.log(`Successfully reloaded ${commands.length} application (/) commands.`);
} catch (error) {
    console.error(error);
}
