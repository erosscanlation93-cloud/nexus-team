import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, EmbedBuilder, ThreadAutoArchiveDuration, MessageFlags,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';

const TIPOS = ['Manhwa', 'Manga', 'Manhua', 'Doujinshi', 'Novela'];
const BUCKET = 'imagenes';

export const data = new SlashCommandBuilder()
  .setName('crear')
  .setDescription('Crea una serie nueva: rol, canal, hilo de anuncios y anuncio del proyecto')
  .addStringOption((o) => o.setName('tipo').setDescription('Tipo de serie').setRequired(true)
    .addChoices(...TIPOS.map((t) => ({ name: t, value: t }))))
  .addStringOption((o) => o.setName('clasificacion').setDescription('Clasificación de edad').setRequired(true)
    .addChoices({ name: '+15', value: '+15' }, { name: '+18', value: '+18' }))
  .addChannelOption((o) => o.setName('categoria').setDescription('Categoría donde irá el canal de la serie')
    .setRequired(true).addChannelTypes(ChannelType.GuildCategory))
  .addAttachmentOption((o) => o.setName('portada').setDescription('Imagen de portada').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction) {
  const tipo = interaction.options.getString('tipo', true);
  const clasificacion = interaction.options.getString('clasificacion', true);
  const categoria = interaction.options.getChannel('categoria', true);
  const portada = interaction.options.getAttachment('portada', true);
  const guild = interaction.guild;

  // --- Validaciones rápidas antes de abrir el formulario ---
  if (!portada.contentType?.startsWith('image/')) {
    return interaction.reply({ content: '❌ La portada debe ser una imagen (png, jpg o webp).', flags: MessageFlags.Ephemeral });
  }
  if (guild.channels.cache.filter((c) => c.parentId === categoria.id).size >= 50) {
    return interaction.reply({ content: `❌ La categoría **${categoria.name}** ya tiene 50 canales (máximo de Discord). Elige otra.`, flags: MessageFlags.Ephemeral });
  }

  // --- Formulario: nombre y sinopsis ---
  const modalId = `crear-${interaction.id}`;
  await interaction.showModal(new ModalBuilder().setCustomId(modalId).setTitle('Nueva serie').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('nombre').setLabel('Nombre de la serie')
        .setStyle(TextInputStyle.Short).setMaxLength(90).setRequired(true)),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('sinopsis').setLabel('Sinopsis')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(3500).setRequired(true)),
  ));

  let form;
  try {
    form = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modalId, time: 15 * 60_000 });
  } catch {
    return; // cerró el formulario o pasaron 15 minutos
  }

  const nombre = form.fields.getTextInputValue('nombre').trim();
  const sinopsis = form.fields.getTextInputValue('sinopsis').trim();
  await form.deferReply({ flags: MessageFlags.Ephemeral });

  // --- Validaciones con los datos del formulario ---
  const nombreSeguro = nombre.replace(/[%_\\]/g, '\\$&');
  const { data: existente, error: errBusqueda } = await db
    .from('series').select('id').ilike('nombre', nombreSeguro).maybeSingle();
  if (errBusqueda) throw errBusqueda;
  if (existente || guild.roles.cache.some((r) => r.name.toLowerCase() === nombre.toLowerCase())) {
    return form.editReply(`❌ Ya existe una serie o un rol llamado **${nombre}**.`);
  }

  const canalProyectos = await guild.channels.fetch(process.env.CANAL_PROYECTOS_ID).catch(() => null);
  if (!canalProyectos) {
    return form.editReply('❌ No encuentro el canal de anuncios de proyectos. Revisa CANAL_PROYECTOS_ID en el .env.');
  }

  // --- Proceso de creación (si algo falla, se deshace todo) ---
  const serieId = randomUUID();
  const ext = (portada.name.split('.').pop() || 'png').toLowerCase();
  const rutaPortada = `portadas/${serieId}.${ext}`;
  let portadaSubida = false;
  const creados = [];

  try {
    // 1. Portada → Supabase Storage (los links de Discord caducan)
    const res = await fetch(portada.url);
    if (!res.ok) throw new Error(`No se pudo descargar la portada (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const { error: errSubida } = await db.storage.from(BUCKET)
      .upload(rutaPortada, buffer, { contentType: portada.contentType, upsert: true });
    if (errSubida) throw errSubida;
    portadaSubida = true;
    const portadaUrl = db.storage.from(BUCKET).getPublicUrl(rutaPortada).data.publicUrl;

    // 2. Rol y canal
    const rol = await guild.roles.create({ name: nombre, reason: `Serie creada por ${interaction.user.tag}` });
    creados.push(rol);

    const canal = await guild.channels.create({
      name: nombre,
      type: ChannelType.GuildText,
      parent: categoria.id,
      topic: `${tipo} · ${clasificacion}`,
      reason: `Serie creada por ${interaction.user.tag}`,
    });
    creados.push(canal);

    // 3. Hilo de anuncios
    const hilo = await canal.threads.create({
      name: 'Anuncios',
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: 'Imágenes para anuncios de capítulos',
    });
    await hilo.send('📌 Sube aquí las imágenes de anuncio con el número de capítulo en el mensaje. Ejemplo: `368` o `361-365`.');

    // 4. Guardar en la base
    const { error: errInsert } = await db.from('series').insert({
      id: serieId,
      nombre,
      sinopsis,
      tipo,
      clasificacion,
      portada_url: portadaUrl,
      rol_id: rol.id,
      canal_id: canal.id,
      hilo_id: hilo.id,
      categoria_id: categoria.id,
      creado_por: interaction.user.id,
    });
    if (errInsert) throw errInsert;

    // 5. Ficha fijada en el canal de la serie
    const ficha = await canal.send({
      embeds: [new EmbedBuilder().setColor(0x9b5cff).setTitle(nombre).setDescription(sinopsis)
        .addFields({ name: 'Tipo', value: tipo, inline: true }, { name: 'Clasificación', value: clasificacion, inline: true })
        .setImage(portadaUrl)],
    });
    await ficha.pin().catch(() => {});

    // 6. Anuncio de nuevo proyecto
    await canalProyectos.send({
      content: `<@&${process.env.ROL_MIEMBROS_ID}>`,
      embeds: [new EmbedBuilder()
        .setColor(0x9b5cff)
        .setTitle('📢 ¡NUEVO PROYECTO PARA EL SCAN!')
        .setDescription(`## ${nombre}\n\n${sinopsis}`)
        .addFields({ name: 'Tipo', value: tipo, inline: true }, { name: 'Clasificación', value: clasificacion, inline: true })
        .setImage(portadaUrl)
        .setTimestamp()],
      allowedMentions: { roles: [process.env.ROL_MIEMBROS_ID] },
    });

    await form.editReply(
      `✅ Serie **${nombre}** creada y guardada\n• Rol: ${rol}\n• Canal: ${canal}\n• Hilo: ${hilo}\n• Anuncio publicado en ${canalProyectos}`,
    );
  } catch (err) {
    console.error('❌ Error en /crear, deshaciendo cambios:', err);
    for (const x of creados.reverse()) await x.delete('Falló /crear, se deshace').catch(() => {});
    await db.from('series').delete().eq('id', serieId);
    if (portadaSubida) await db.storage.from(BUCKET).remove([rutaPortada]);
    await form.editReply(`❌ Algo falló al crear la serie y se deshicieron los cambios.\n\`${err.message ?? err}\``);
  }
}