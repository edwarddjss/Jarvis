import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { config } from 'dotenv';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';
import { Command } from './types';
import { ElevenLabsConversationalAI } from './api/elevenlabs/conversationalClient.js';
import { logger } from './config/logger.js';

config();

declare module 'discord.js' {
  export interface Client {
    commands: Collection<string, Command>;
    voiceManager?: ElevenLabsConversationalAI;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

const init = async () => {
  try {
    // Initialize commands and events
    await loadCommands(client);
    await loadEvents(client);

    // Initialize voice functionality
    if (!process.env.ELEVENLABS_API_KEY) {
      logger.error('ELEVENLABS_API_KEY is not set in environment variables');
    } else {
      logger.info('Initializing voice capabilities...');
    }

    // Login to Discord
    await client.login(process.env.DISCORD_TOKEN);
    
    logger.info(`Bot is ready! Logged in as ${client.user?.tag}`);
  } catch (error) {
    console.error('Error initializing bot:', error);
  }
};

// Handle process termination gracefully
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Cleaning up...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Cleaning up...');
  client.destroy();
  process.exit(0);
});

init();