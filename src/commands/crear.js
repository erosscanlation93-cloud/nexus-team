import {
  SlashCommandBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, EmbedBuilder, ThreadAutoArchiveDuration, MessageFlags, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';

const TIPOS = ['Manhwa', 'Manga', 'Manhua', 'Doujinshi', 'Novela'];
const BUCKET = 'imagenes';

// Quién puede usarlo: 'admin' o 'miembro'
export const permiso = 'admin';

export const data = new SlashCommandBuilder()
  .setName('crear')
  .setDescription('Crea una serie nueva: rol, canal, hilo de anuncios y anuncio del proyecto')
  .addStringOption((o) => o.setName('tipo').setDescription('Tipo de serie').setRequired(true)
    .addChoices(...TIPOS.map((t) => ({ name: t, value: t }))))
  .addStringOption((o) => o.setName('clasificacion').setDescription('Clasificación de edad').setRequired(true)
    .addChoices({ name: '+15', value: '+15' }, { name: '+18', value: '+18' }))
  .addChannelOption((o) => o.setName('categoria').setDescription('Categoría donde irá el canal de la serie')
    .setRequired(true).addChannelTypes(ChannelType.GuildCategory))
  .addAttachmentOption((o) => o.setName('portada').setDescription('(Opcional) Imagen de portada').setRequired(false));

export async function execute(interaction) {
  const tipo = interaction.options.getString('tipo', true);
  const clasificacion = interaction.options.getString('clasificacion', true);
  const categoria = interaction.options.getChannel('categoria', true);
  const portada = interaction.options.getAttachment('portada'); // opcional
  const guild = interaction.guild;

  // --- Validaciones rápidas antes de abrir el formulario ---
  if (portada && !portada.contentType?.startsWith('image/')) {
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
      new TextInputBuilder().setCustomId('sinopsis').setLabel('Sinopsis (opcional)')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(3500).setRequired(false)),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('drive').setLabel('Link del Drive de raws (opcional)')
        .setPlaceholder('https://drive.google.com/...')
        .setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(false)),
  ));

  let form;
  try {
    form = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modalId, time: 15 * 60_000 });
  } catch {
    return; // cerró el formulario o pasaron 15 minutos
  }

  const nombre = form.fields.getTextInputValue('nombre').trim();
  const sinopsis = form.fields.getTextInputValue('sinopsis')?.trim() || null; // opcional
  const drive = form.fields.getTextInputValue('drive')?.trim() || null;       // opcional
  await form.deferReply({ flags: MessageFlags.Ephemeral });

  if (drive && !/^https:\/\/\S+$/i.test(drive)) {
    return form.editReply('❌ El link del Drive no es válido (debe empezar con `https://`). No se creó nada, vuelve a intentarlo.');
  }

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
  const ext = portada ? (portada.name.split('.').pop() || 'png').toLowerCase() : null;
  const rutaPortada = portada ? `portadas/${serieId}.${ext}` : null;
  let portadaSubida = false;
  const creados = [];

  try {
    // 1. Portada → Supabase Storage (solo si se adjuntó; los links de Discord caducan)
    let portadaUrl = null;
    if (portada) {
      const res = await fetch(portada.url);
      if (!res.ok) throw new Error(`No se pudo descargar la portada (${res.status})`);
      const buffer = Buffer.from(await res.arrayBuffer());

      const { error: errSubida } = await db.storage.from(BUCKET)
        .upload(rutaPortada, buffer, { contentType: portada.contentType, upsert: true });
      if (errSubida) throw errSubida;
      portadaSubida = true;
      portadaUrl = db.storage.from(BUCKET).getPublicUrl(rutaPortada).data.publicUrl;
    }

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
      drive_link: drive,
      creado_por: interaction.user.id,
    });
    if (errInsert) throw errInsert;

    // 5. Ficha fijada en el canal de la serie
    const embedFicha = new EmbedBuilder().setColor(0x9b5cff).setTitle(nombre)
      .addFields({ name: 'Tipo', value: tipo, inline: true }, { name: 'Clasificación', value: clasificacion, inline: true });
    if (sinopsis) embedFicha.setDescription(sinopsis);
    if (portadaUrl) embedFicha.setImage(portadaUrl);
    if (drive) embedFicha.addFields({ name: '📂 Raws', value: drive });

    const ficha = await canal.send({
      embeds: [embedFicha],
      components: drive ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Abrir Drive de raws').setEmoji('📂').setURL(drive),
      )] : [],
    });
    await ficha.pin().catch(() => {});

    // 6. Anuncio de nuevo proyecto
    const embedAnuncio = new EmbedBuilder()
      .setColor(0x9b5cff)
      .setTitle('📢 ¡NUEVO PROYECTO PARA EL SCAN!')
      .setDescription(sinopsis ? `## ${nombre}\n\n${sinopsis}` : `## ${nombre}`)
      .addFields({ name: 'Tipo', value: tipo, inline: true }, { name: 'Clasificación', value: clasificacion, inline: true })
      .setTimestamp();
    if (portadaUrl) embedAnuncio.setImage(portadaUrl);

    await canalProyectos.send({
      content: `<@&${process.env.ROL_MIEMBROS_ID}>`,
      embeds: [embedAnuncio],
      allowedMentions: { roles: [process.env.ROL_MIEMBROS_ID] },
    });

    const faltantes = [!portadaUrl && 'portada', !sinopsis && 'sinopsis', !drive && 'link de raws'].filter(Boolean);
    await form.editReply(
      `✅ Serie **${nombre}** creada y guardada\n• Rol: ${rol}\n• Canal: ${canal}\n• Hilo: ${hilo}\n• Anuncio publicado en ${canalProyectos}`
      + (faltantes.length ? `\nℹ️ Se creó sin ${faltantes.join(' ni ')}.` : ''),
    );
  } catch (err) {
    console.error('❌ Error en /crear, deshaciendo cambios:', err);
    for (const x of creados.reverse()) await x.delete('Falló /crear, se deshace').catch(() => {});
    await db.from('series').delete().eq('id', serieId);
    if (portadaSubida) await db.storage.from(BUCKET).remove([rutaPortada]);
    await form.editReply(`❌ Algo falló al crear la serie y se deshicieron los cambios.\n\`${err.message ?? err}\``);
  }
}