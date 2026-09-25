import {
  SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType,
} from 'discord.js';
import { db } from '../db.js';
import { serieDelCanal } from '../utils/series.js';
import { formatearCapitulos } from '../utils/capitulos.js';
import { webhookPara, enviarAnuncio } from '../utils/anuncios.js';

// Quién puede usarlo: 'admin' o 'miembro'
export const permiso = 'admin';

export const data = new SlashCommandBuilder()
  .setName('publicar')
  .setDescription('Anuncia capítulos listos (con TP) en el Discord de la comunidad')
  .addStringOption((o) => o.setName('acceso').setDescription('Canal de anuncio (por defecto: gratis)')
    .addChoices({ name: 'Gratis', value: 'gratis' }, { name: 'Premium', value: 'premium' }));
function elegirImagen(imagenes, caps) {
  const min = Math.min(...caps);
  const max = Math.max(...caps);
  const cubre = (i, a, b) => Number(i.cap_desde) <= a && Number(i.cap_hasta) >= b;
  return imagenes.find((i) => cubre(i, min, max))
      ?? imagenes.find((i) => cubre(i, min, min))
      ?? imagenes.find((i) => caps.some((c) => cubre(i, c, c)))
      ?? null;
}

export async function execute(interaction) {
  const acceso = interaction.options.getString('acceso') ?? 'gratis';
  const efimero = { flags: MessageFlags.Ephemeral };

  const serie = await serieDelCanal(interaction.channel);
  if (!serie) return interaction.reply({ content: '❌ Usa este comando dentro del canal de una serie.', ...efimero });

  const webhookUrl = webhookPara(acceso, serie.clasificacion);
  if (!webhookUrl) {
    return interaction.reply({ content: `❌ Falta configurar en el .env el webhook para anuncios **${acceso} ${serie.clasificacion}**.`, ...efimero });
  }
  if (!serie.link) {
    return interaction.reply({ content: `❌ **${serie.nombre}** no tiene link todavía. Agrégalo primero con \`/link\`.`, ...efimero });
  }

  await interaction.deferReply(efimero);

  // --- Capítulos listos (con TP) que aún no se anunciaron ---
  const [{ data: tps, error: e1 }, { data: publicados, error: e2 }, { data: imagenes, error: e3 }] = await Promise.all([
    db.from('registros').select('capitulo').eq('serie_id', serie.id).eq('rol', 'TP'),
    db.from('publicaciones').select('capitulo, acceso').eq('serie_id', serie.id),
    db.from('imagenes_anuncio').select('*').eq('serie_id', serie.id).order('creado_en', { ascending: false }),
  ]);
  if (e1 || e2 || e3) throw e1 || e2 || e3;

  // Un capítulo se anuncia 1 vez en premium y 1 vez en gratis (premium nunca después de gratis)
  const pubGratis = new Set(publicados.filter((p) => p.acceso === 'gratis').map((p) => Number(p.capitulo)));
  const pubPremium = new Set(publicados.filter((p) => p.acceso === 'premium').map((p) => Number(p.capitulo)));
  const pendientes = [...new Set(tps.map((t) => Number(t.capitulo)))]
    .filter((c) => (acceso === 'gratis' ? !pubGratis.has(c) : !pubPremium.has(c) && !pubGratis.has(c)))
    .sort((a, b) => a - b);

  if (!pendientes.length) {
    return interaction.editReply('ℹ️ No hay capítulos pendientes. Solo aparecen los que tienen TP registrado y aún no se anunciaron.');
  }

  const visibles = pendientes.slice(0, 25); // límite de Discord por menú
  const menu = new StringSelectMenuBuilder()
    .setCustomId('caps')
    .setPlaceholder('Elige los capítulos a anunciar')
    .setMinValues(1)
    .setMaxValues(visibles.length)
    .addOptions(visibles.map((c) => new StringSelectMenuOptionBuilder()
      .setValue(String(c))
      .setLabel(`Capítulo ${c}`)
      .setDescription((pubPremium.has(c) ? '⭐ Ya salió en premium · ' : '')
        + (elegirImagen(imagenes, [c]) ? '🖼️ Con imagen'
          : serie.portada_url ? '⚠️ Sin imagen, se usará la portada' : '⚠️ Sin imagen ni portada'))));

  const extra = pendientes.length > 25 ? `\n(Se muestran los 25 primeros de ${pendientes.length} pendientes)` : '';
  const respuesta = await interaction.editReply({
    content: `📋 **${serie.nombre}** · ${pendientes.length} capítulo(s) listos para anunciar en **${acceso}**.${extra}`,
    components: [new ActionRowBuilder().addComponents(menu)],
  });

  let seleccion;
  try {
    seleccion = await respuesta.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.user.id === interaction.user.id,
      time: 5 * 60_000,
    });
  } catch {
    return interaction.editReply({ content: '⌛ Se acabó el tiempo. Vuelve a usar /publicar.', components: [] });
  }
  await seleccion.deferUpdate();

  const caps = seleccion.values.map(Number).sort((a, b) => a - b);
  const textoCaps = formatearCapitulos(caps);
  const imagen = elegirImagen(imagenes, caps);

  // --- Anuncio en la comunidad ---
  try {
    await enviarAnuncio({
      webhookUrl, serie, textoCaps, acceso,
      plural: caps.length > 1,
      imagenUrl: imagen?.imagen_url ?? serie.portada_url,
    });
  } catch (err) {
    console.error('❌ Error enviando el anuncio:', err);
    return interaction.editReply({ content: `❌ No se pudo enviar el anuncio a la comunidad.\n\`${err.message}\``, components: [] });
  }

  // --- Registrar como publicados ---
  const { error: errPub } = await db.from('publicaciones').upsert(
    caps.map((capitulo) => ({ serie_id: serie.id, capitulo, acceso, publicado_por: interaction.user.id })),
    { onConflict: 'serie_id,capitulo,acceso', ignoreDuplicates: true },
  );
  if (errPub) console.error('⚠️ Anuncio enviado pero no se marcó como publicado:', errPub);

  // Constancia en el canal de la serie
  await interaction.channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(`📢 Anunciado en la comunidad · ${acceso} ${serie.clasificacion}`)
      .setDescription(`########## ${caps.length > 1 ? 'Capítulos' : 'Capítulo'} ${textoCaps} ##########`)
      .setThumbnail(serie.portada_url) // la imagen del hilo puede borrarse después
      .setFooter({ text: `Publicado por ${interaction.member?.displayName ?? interaction.user.username}` })
      .setTimestamp()],
  });

  // Tras anunciar en gratis, las imágenes del hilo ya no se usan: se limpian
  let limpiadas = 0;
  if (acceso === 'gratis') {
    for (const c of caps) pubGratis.add(c);
    limpiadas = await limpiarImagenes(interaction, serie, imagenes, pubGratis);
  }

  await interaction.editReply({
    content: `✅ Anunciado: **${serie.nombre}** · ${textoCaps}${limpiadas ? `\n🧹 Se borraron ${limpiadas} imagen(es) del hilo que ya no se usarán.` : ''}${imagen ? '' : serie.portada_url ? '\n⚠️ Se usó la portada porque no había imagen en el hilo.' : '\n⚠️ Salió sin imagen: no había en el hilo y la serie no tiene portada.'}`,
    components: [],
  });
}

// Borra del hilo (y de Storage) las imágenes cuyos capítulos ya salieron todos en gratis.
// Una imagen de rango (ej. 361-365) solo se borra cuando todo el rango se anunció gratis.
async function limpiarImagenes(interaction, serie, imagenes, pubGratis) {
  const capsDe = (i) => {
    const desde = Number(i.cap_desde);
    const hasta = Number(i.cap_hasta);
    return desde === hasta ? [desde] : Array.from({ length: hasta - desde + 1 }, (_, k) => desde + k);
  };
  const aBorrar = imagenes.filter((i) => capsDe(i).every((c) => pubGratis.has(c)));
  if (!aBorrar.length) return 0;

  const hilo = await interaction.guild.channels.fetch(serie.hilo_id).catch(() => null);
  for (const img of aBorrar) {
    if (hilo && img.mensaje_id) {
      if (hilo.archived) await hilo.setArchived(false).catch(() => {});
      await hilo.messages.delete(img.mensaje_id).catch(() => {});
    }
    const ruta = img.imagen_url.split('/imagenes/')[1];
    if (ruta) await db.storage.from('imagenes').remove([ruta]);
    await db.from('imagenes_anuncio').delete().eq('id', img.id);
  }
  return aBorrar.length;
}