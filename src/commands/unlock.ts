import { 
    ChatInputCommandInteraction,
    PermissionsBitField, 
    SlashCommandBuilder, 
    VoiceChannel, 
    GuildMember
} from 'discord.js';
import { Command } from '../types';
import { logger } from '../config/logger.js';

const data = new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Makes the current voice channel public again');

const command: Command = {
    data: data.toJSON(),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const member = interaction.member as GuildMember;
            
            if (!member?.voice?.channel) {
                await interaction.editReply({
                    content: '❌ You must be in a voice channel to use this command!'
                });
                return;
            }

            const voiceChannel = member.voice.channel as VoiceChannel;
            
            // Check bot's permissions first
            const botMember = interaction.guild?.members.cache.get(interaction.client.user.id);
            if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                await interaction.editReply({
                    content: '❌ I don\'t have permission to manage channels. Please check my role permissions.'
                });
                return;
            }

            await voiceChannel.permissionOverwrites.set([
                {
                    id: interaction.guild!.roles.everyone.id,
                    allow: [PermissionsBitField.Flags.Connect]
                }
            ]);
            
            await interaction.editReply({
                content: '🔓 Voice channel is now public'
            });
        } catch (error) {
            logger.error('Error unlocking channel:', error);
            await interaction.editReply({
                content: '❌ Error: Make sure I have the correct permissions and my role is positioned above the voice channel in the server settings.'
            });
        }
    }
};

export default command;