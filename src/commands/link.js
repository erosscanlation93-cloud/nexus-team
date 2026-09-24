import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { db } from '../db.js';
import { serieDelCanal } from '../utils/series.js';

const DOMINIO = process.env.WEB_DOMINIO || 'nexusscanlation.com';

// Quién puede usarlo: 'admin' o 'miembro'
export const permiso = 'admin';

export const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Muestra o cambia el link de la serie en la web (usar en el canal de la serie)')
  .addStringOption((o) => o.setName('url').setDescription(`Link de la serie en ${DOMINIO}`).setRequired(false));

export async function execute(interaction) {
  const serie = await serieDelCanal(interaction.channel);
  if (!serie) {
    return interaction.reply({ content: '❌ Usa este comando dentro del canal de una serie.', flags: MessageFlags.Ephemeral });
  }

  const url = interaction.options.getString('url')?.trim();

  // Sin argumento: solo muestra el link actual
  if (!url) {
    return interaction.reply({
      content: serie.link
        ? `🔗 Link de **${serie.nombre}**: ${serie.link}`
        : `⚠️ **${serie.nombre}** todavía no tiene link. Agrégalo con \`/link url:...\``,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Validar que sea un link de la web
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return interaction.reply({ content: '❌ Eso no es un link válido. Debe empezar con `https://`.', flags: MessageFlags.Ephemeral });
  }
  const host = parsed.hostname.replace(/^www\./, '');
  if (parsed.protocol !== 'https:' || host !== DOMINIO) {
    return interaction.reply({ content: `❌ El link debe ser de **${DOMINIO}** y empezar con \`https://\`.`, flags: MessageFlags.Ephemeral });
  }

  const { error } = await db.from('series').update({ link: parsed.href }).eq('id', serie.id);
  if (error) throw error;

  await interaction.reply({
    content: serie.link
      ? `✅ Link de **${serie.nombre}** actualizado.\nAntes: ${serie.link}\nAhora: ${parsed.href}`
      : `✅ Link de **${serie.nombre}** guardado: ${parsed.href}`,
    flags: MessageFlags.Ephemeral,
  });
}
