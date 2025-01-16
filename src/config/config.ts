import 'dotenv/config';

function loadEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} environment variable is not set`);
  }
  return value;
}

export const DISCORD_CONFIG = {
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || '',
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
  DEBUG: process.env.DEBUG === 'true'
};

export const ELEVENLABS_CONFIG = {
  AGENT_ID: loadEnv('AGENT_ID'),
};