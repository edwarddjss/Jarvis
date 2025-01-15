import { PermissionsBitField, SlashCommandBuilder, VoiceChannel, GuildMember, ChannelType, MessageFlags } from 'discord.js';
import { Command } from '../types';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Makes the current voice channel private'),
    
  async execute(interaction) {
    const member = interaction.member as GuildMember;
    
    // Defer the reply immediately
    await interaction.deferReply({ ephemeral: true });
    
    if (!member?.voice?.channel) {
      await interaction.editReply({
        content: 'You must be in a voice channel to use this command!'
      });
      return;
    }

    const voiceChannel = member.voice.channel as VoiceChannel;
    
    // Check bot's permissions first
    const botMember = interaction.guild?.members.cache.get(interaction.client.user.id);
    if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      await interaction.editReply({
        content: 'I don\'t have permission to manage channels. Please check my role permissions.'
      });
      return;
    }

    try {
      await voiceChannel.permissionOverwrites.set([
        {
          id: interaction.guild!.roles.everyone.id,
          deny: [PermissionsBitField.Flags.Connect]
        }
      ]);
      
      await interaction.editReply({
        content: '🔒 Voice channel is now private'
      });
    } catch (error) {
      console.error('Error locking channel:', error);
      await interaction.editReply({
        content: 'Error: Make sure I have the correct permissions and my role is positioned above the voice channel in the server settings.'
      });
    }
  }
};

export const { data, execute } = command;