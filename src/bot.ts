import {
    ChatInputCommandInteraction,
    Client,
    Collection,
    Events,
    GatewayIntentBits,
    SlashCommandBuilder,
  } from 'discord.js';
  import { readdirSync } from 'fs';
  import path from 'path';
  import { fileURLToPath } from 'url';
  import { DISCORD_CONFIG, logger } from './config/index.js';
  import { deployCommands } from './utils/index.js';
  
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  
  interface Command extends SlashCommandBuilder {
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  }
  
  class Bot extends Client {
    customCommands = new Collection<string, Command>();
  
    async loadCommands(): Promise<void> {
      const commandsPath = path.join(__dirname, 'commands');
      for (const file of readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
        const command = await import(`file://${path.join(commandsPath, file)}`);
        if ('data' in command && 'execute' in command) {
          this.customCommands.set(command.data.name, command);
          logger.info(`Loaded command ${command.data.name}`);
        }
      }
    }
  
    async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
      try {
        await this.customCommands.get(interaction.commandName)?.execute(interaction);
      } catch (error) {
        logger.error(error, 'Command execution error');
        const response = { content: 'Command execution failed!', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(response);
        } else {
          await interaction.reply(response);
        }
      }
    }
  }
  
  const bot = new Bot({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  
  bot.on(Events.InteractionCreate, interaction => {
    if (interaction.isChatInputCommand()) {
      bot.handleCommand(interaction);
    }
  });
  
  bot.once(Events.ClientReady, async () => {
    await deployCommands();
    await bot.loadCommands();
    logger.info(`Ready! Logged in as ${bot.user?.username}`);
  });
  
  bot.login(DISCORD_CONFIG.DISCORD_BOT_TOKEN);