import { SlashCommandBuilder, MessageFlags } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Comprueba que el bot responde');

export async function execute(interaction) {
  await interaction.reply({
    content: `🏓 Pong! Latencia: ${interaction.client.ws.ping} ms`,
    flags: MessageFlags.Ephemeral,
  });
}