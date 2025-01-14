import { PermissionsBitField, SlashCommandBuilder, VoiceChannel, GuildMember, ChannelType, MessageFlags } from 'discord.js';
import { Command } from '../types';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Makes the current voice channel public'),
    
  async execute(interaction) {
    const member = interaction.member as GuildMember;
    
    if (!member?.voice?.channel) {
      await interaction.reply({
        content: 'You must be in a voice channel to use this command!',
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    const voiceChannel = member.voice.channel as VoiceChannel;
    
    // Check bot's permissions first
    const botMember = interaction.guild?.members.cache.get(interaction.client.user.id);
    if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      await interaction.reply({
        content: 'I don\'t have permission to manage channels. Please check my role permissions.',
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    try {
      await voiceChannel.permissionOverwrites.set([
        {
          id: interaction.guild!.roles.everyone.id,
          allow: [PermissionsBitField.Flags.Connect]
        }
      ]);
      
      await interaction.reply({
        content: '🔓 Voice channel is now public',
        flags: [MessageFlags.Ephemeral]
      });
    } catch (error) {
      console.error('Error unlocking channel:', error);
      await interaction.reply({
        content: 'Error: Make sure I have the correct permissions and my role is positioned above the voice channel in the server settings.',
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};

export const { data, execute } = command;