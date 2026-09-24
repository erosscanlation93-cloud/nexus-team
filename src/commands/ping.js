import { SlashCommandBuilder, MessageFlags } from 'discord.js';

// Quién puede usarlo: 'admin' o 'miembro'
export const permiso = 'admin';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Comprueba que el bot responde');

export async function execute(interaction) {
  await interaction.reply({
    content: `🏓 Pong! Latencia: ${interaction.client.ws.ping} ms`,
    flags: MessageFlags.Ephemeral,
  });
}
