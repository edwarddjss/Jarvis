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
    console.log('Bot Token:', DISCORD_CONFIG.DISCORD_BOT_TOKEN ? 'Set' : 'Not Set');
    console.log('Bot Token Length:', DISCORD_CONFIG.DISCORD_BOT_TOKEN?.length);
    console.log('ElevenLabs Agent ID:', ELEVENLABS_CONFIG.AGENT_ID ? 'Set' : 'Not Set');
    console.log('ElevenLabs Agent ID Length:', ELEVENLABS_CONFIG.AGENT_ID?.length);
    console.log('ElevenLabs Agent ID First 4 Characters:', ELEVENLABS_CONFIG.AGENT_ID?.substring(0, 4));

    // Initialize commands and events
    await loadCommands(client);
    await loadEvents(client);

    // Initialize voice functionality
    if (!ELEVENLABS_CONFIG.AGENT_ID) {
      logger.error('AGENT_ID is not set in environment variables');
    } else {
      logger.info('Initializing voice capabilities...');
      // Here you would initialize the ElevenLabsConversationalAI
      // client.voiceManager = new ElevenLabsConversationalAI(...);
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