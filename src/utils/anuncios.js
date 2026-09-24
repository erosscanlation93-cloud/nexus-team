import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MediaGalleryBuilder,
  MediaGalleryItemBuilder, MessageFlags, TextDisplayBuilder, WebhookClient,
} from 'discord.js';

// A qué webhook va cada anuncio: premium, o gratis según la clasificación de la serie
export function webhookPara(acceso, clasificacion) {
  if (acceso === 'premium') return process.env.WEBHOOK_PREMIUM;
  return clasificacion === '+15' ? process.env.WEBHOOK_GRATIS_15 : process.env.WEBHOOK_GRATIS_18;
}

// Texto del anuncio, con el mismo formato que usaban los bots anteriores
function textoAnuncio({ serie, textoCaps, plural, acceso }) {
  const menciones = `📢 ${process.env.ROL_LECTOR_ID ? `<@&${process.env.ROL_LECTOR_ID}>` : ''} 💬 @everyone`;

  if (acceso === 'premium') {
    return {
      titulo: `⭐ CAPÍTULO PREMIUM DE ${serie.nombre.toUpperCase()} - ${plural ? 'CAPÍTULOS' : 'CAPÍTULO'} ${textoCaps}`,
      cuerpo: '💎 **Contenido exclusivo y anticipado** para la comunidad.\n📖 Accede antes que nadie a este capítulo premium.',
      menciones,
    };
  }

  const titulo = `📖 ${serie.nombre.toUpperCase()} — ${plural ? 'Capítulos' : 'Capítulo'} ${textoCaps}`;
  const cuerpo = serie.clasificacion === '+15'
    ? `✨ ¡${plural ? 'Nuevos capítulos disponibles' : 'Nuevo capítulo disponible'}!\n\n📌 **GRACIAS AL STAFF POR EL TRABAJO REALIZADO**`
    : `✨ ¡${plural ? 'Nuevos capítulos disponibles' : 'Nuevo capítulo disponible'}!\n\n🆓 *¡Contenido gratuito para todos!*\n\n**GRACIAS AL STAFF POR EL TRABAJO REALIZADO**`;
  return { titulo, cuerpo, menciones };
}

export async function enviarAnuncio({ webhookUrl, serie, textoCaps, plural, acceso, imagenUrl }) {
  const { titulo, cuerpo, menciones } = textoAnuncio({ serie, textoCaps, plural, acceso });
  const allowedMentions = {
    parse: ['everyone'],
    roles: process.env.ROL_LECTOR_ID ? [process.env.ROL_LECTOR_ID] : [],
  };
  const boton = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Leer en Nexus').setEmoji('📖').setURL(serie.link),
  );

  const webhook = new WebhookClient({ url: webhookUrl });
  try {
    // Formato moderno (igual a tus bots): texto, imagen y botón, sin barra de embed
    await webhook.send({
      flags: MessageFlags.IsComponentsV2,
      withComponents: true,
      allowedMentions,
      components: [
        new TextDisplayBuilder().setContent(`## [${titulo}](${serie.link})\n${cuerpo}\n\n${menciones}`),
        new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imagenUrl)),
        boton,
      ],
    });
  } catch (err) {
    // Respaldo clásico por si Discord rechaza el formato moderno
    console.warn('⚠️ Formato moderno rechazado, uso el clásico:', err.message);
    await webhook.send({
      content: menciones,
      allowedMentions,
      withComponents: true,
      embeds: [new EmbedBuilder().setTitle(titulo).setURL(serie.link).setDescription(cuerpo).setImage(imagenUrl)],
      components: [boton],
    });
  } finally {
    webhook.destroy();
  }
}