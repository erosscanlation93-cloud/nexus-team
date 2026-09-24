import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

// Ficha fijada en el canal de cada serie (la usan /crear y /editar)
export function construirFicha(serie) {
  const embed = new EmbedBuilder()
    .setColor(0x9b5cff)
    .setTitle(serie.nombre)
    .addFields(
      { name: 'Tipo', value: serie.tipo, inline: true },
      { name: 'Clasificación', value: serie.clasificacion, inline: true },
    );
  if (serie.sinopsis) embed.setDescription(serie.sinopsis);
  if (serie.drive_link) embed.addFields({ name: '📂 Raws', value: serie.drive_link });
  if (serie.portada_url) embed.setImage(serie.portada_url);

  const components = serie.drive_link
    ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Abrir Drive de raws').setEmoji('📂').setURL(serie.drive_link),
    )]
    : [];

  return { embeds: [embed], components };
}

// Busca la ficha fijada por el bot en el canal de la serie
export async function buscarFicha(canal) {
  const { items } = await canal.messages.fetchPins();
  return items.map((i) => i.message).find((m) => m.author.id === canal.client.user.id) ?? null;
}