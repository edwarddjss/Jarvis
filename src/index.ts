import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';
import { Command } from './types';
import { ElevenLabsConversationalAI } from './api/elevenlabs/conversationalClient.js';
import { logger } from './config/logger.js';
import { DISCORD_CONFIG, ELEVENLABS_CONFIG } from './config/config.js';

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
    console.log('DISCORD_BOT_TOKEN length:', DISCORD_CONFIG.DISCORD_BOT_TOKEN?.length);
    console.log('AGENT_ID length:', ELEVENLABS_CONFIG.AGENT_ID?.length);

    // Initialize commands and events
    await loadCommands(client);
    await loadEvents(client);

    // Initialize voice functionality
    if (!ELEVENLABS_CONFIG.AGENT_ID) {
      logger.error('AGENT_ID is not set in environment variables');
    } else {
      logger.info('Initializing voice capabilities...');
      client.voiceManager = new ElevenLabsConversationalAI(/* pass necessary parameters */);
      try {
        await client.voiceManager.connect();
        logger.info('Voice capabilities initialized successfully');
      } catch (error) {
        logger.error('Failed to initialize voice capabilities:', error);
      }
    }

    // Login to Discord
    await client.login(DISCORD_CONFIG.DISCORD_BOT_TOKEN);
    
    logger.info(`Bot is ready! Logged in as ${client.user?.tag}`);
  } catch (error) {
    console.error('Error initializing bot:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
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