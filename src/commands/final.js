import {
  SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, EmbedBuilder,
} from 'discord.js';
import { db } from '../db.js';
import { serieDelCanal } from '../utils/series.js';

const BUCKET = 'imagenes';

export const permiso = 'admin';

export const data = new SlashCommandBuilder()
  .setName('final')
  .setDescription('Da por terminada la serie: borra su rol, canal e hilo (usar en su canal)')
  .addBooleanOption((o) => o.setName('borrar_historial')
    .setDescription('También borrar todos sus registros de trabajo (no recomendado)').setRequired(false));

export async function execute(interaction) {
  const serie = await serieDelCanal(interaction.channel);
  if (!serie) {
    return interaction.reply({ content: '❌ Usa este comando dentro del canal de una serie.', flags: MessageFlags.Ephemeral });
  }
  const borrarHistorial = interaction.options.getBoolean('borrar_historial') ?? false;

  const { count: totalRegistros } = await db.from('registros')
    .select('id', { count: 'exact', head: true }).eq('serie_id', serie.id);

  // --- Confirmación (acción irreversible) ---
  const botones = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirmar').setLabel('Sí, finalizar').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
  );
  const respuesta = await interaction.reply({
    content: `⚠️ Vas a finalizar **${serie.nombre}**. Se borrarán su **rol**, su **canal** y su **hilo**.\n`
      + (borrarHistorial
        ? `🗑️ También se borrarán sus **${totalRegistros ?? 0} registros de trabajo** para siempre.`
        : `📦 Sus **${totalRegistros ?? 0} registros de trabajo** se conservan para /exportar y los pagos.`)
      + '\n\nEsto no se puede deshacer. ¿Continuar?',
    components: [botones],
    flags: MessageFlags.Ephemeral,
    withResponse: true,
  });

  let clic;
  try {
    clic = await respuesta.resource.message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id,
      time: 60_000,
    });
  } catch {
    return interaction.editReply({ content: '⌛ Tiempo agotado, no se borró nada.', components: [] });
  }
  if (clic.customId === 'cancelar') {
    return clic.update({ content: 'Cancelado, no se borró nada.', components: [] });
  }
  await clic.update({ content: '⏳ Finalizando serie...', components: [] });

  const guild = interaction.guild;

  // --- Imágenes en Storage (anuncios, y portada si se borra todo) ---
  const { data: archivos } = await db.storage.from(BUCKET).list(`anuncios/${serie.id}`, { limit: 1000 });
  const rutas = (archivos ?? []).map((a) => `anuncios/${serie.id}/${a.name}`);
  const rutaPortada = serie.portada_url?.split(`/${BUCKET}/`)[1];
  if (borrarHistorial && rutaPortada) rutas.push(rutaPortada);
  if (rutas.length) await db.storage.from(BUCKET).remove(rutas);

  // --- Base de datos ---
  if (borrarHistorial) {
    const { error } = await db.from('series').delete().eq('id', serie.id); // borra en cascada registros, imágenes y publicaciones
    if (error) throw error;
  } else {
    await db.from('imagenes_anuncio').delete().eq('serie_id', serie.id);
    const { error } = await db.from('series').update({
      activa: false, canal_id: null, hilo_id: null, rol_id: null,
    }).eq('id', serie.id);
    if (error) throw error;
  }

  // --- Aviso en el canal de proyectos ---
  const canalProyectos = await guild.channels.fetch(process.env.CANAL_PROYECTOS_ID).catch(() => null);
  await canalProyectos?.send({
    embeds: [new EmbedBuilder()
      .setColor(0x64748b)
      .setTitle('🏁 SERIE FINALIZADA')
      .setDescription(`## ${serie.nombre}\nGracias a todo el equipo por el trabajo realizado.`)
      .setThumbnail(borrarHistorial ? null : serie.portada_url)
      .setFooter({ text: `Finalizada por ${interaction.member?.displayName ?? interaction.user.username}` })
      .setTimestamp()],
  }).catch(() => {});

  // --- Discord: rol y canal (el hilo se borra con el canal). El canal va al final porque es donde estamos ---
  const rol = await guild.roles.fetch(serie.rol_id).catch(() => null);
  await rol?.delete(`Serie finalizada por ${interaction.user.tag}`).catch(() => {});
  const canal = await guild.channels.fetch(serie.canal_id).catch(() => null);
  await canal?.delete(`Serie finalizada por ${interaction.user.tag}`).catch(() => {});
}