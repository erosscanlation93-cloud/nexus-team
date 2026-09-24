import {
  SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, MessageFlags,
} from 'discord.js';
import { db } from '../db.js';
import { serieDelCanal } from '../utils/series.js';
import { construirFicha, buscarFicha } from '../utils/ficha.js';

const BUCKET = 'imagenes';
const esperar = (ms) => new Promise((r) => setTimeout(() => r('timeout'), ms));

export const permiso = 'admin';

export const data = new SlashCommandBuilder()
  .setName('editar')
  .setDescription('Corrige nombre, sinopsis, link de raws o portada de la serie (usar en su canal)')
  .addAttachmentOption((o) => o.setName('portada').setDescription('(Opcional) Nueva imagen de portada').setRequired(false));

export async function execute(interaction) {
  const serie = await serieDelCanal(interaction.channel);
  if (!serie) {
    return interaction.reply({ content: '❌ Usa este comando dentro del canal de una serie.', flags: MessageFlags.Ephemeral });
  }
  const portada = interaction.options.getAttachment('portada');
  if (portada && !portada.contentType?.startsWith('image/')) {
    return interaction.reply({ content: '❌ La portada debe ser una imagen (png, jpg o webp).', flags: MessageFlags.Ephemeral });
  }

  // --- Formulario con los datos actuales ya cargados ---
  const campo = (id, label, estilo, max, requerido, valor) => {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label)
      .setStyle(estilo).setMaxLength(max).setRequired(requerido);
    if (valor) input.setValue(valor);
    return new ActionRowBuilder().addComponents(input);
  };
  const modalId = `editar-${interaction.id}`;
  await interaction.showModal(new ModalBuilder().setCustomId(modalId).setTitle('Editar serie').addComponents(
    campo('nombre', 'Nombre de la serie', TextInputStyle.Short, 90, true, serie.nombre),
    campo('sinopsis', 'Sinopsis (opcional)', TextInputStyle.Paragraph, 3500, false, serie.sinopsis),
    campo('drive', 'Link del Drive de raws (opcional)', TextInputStyle.Short, 500, false, serie.drive_link),
  ));

  let form;
  try {
    form = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modalId, time: 15 * 60_000 });
  } catch {
    return;
  }
  await form.deferReply({ flags: MessageFlags.Ephemeral });

  const nombre = form.fields.getTextInputValue('nombre').trim();
  const sinopsis = form.fields.getTextInputValue('sinopsis')?.trim() || null;
  const drive = form.fields.getTextInputValue('drive')?.trim() || null;

  if (drive && !/^https:\/\/\S+$/i.test(drive)) {
    return form.editReply('❌ El link del Drive no es válido (debe empezar con `https://`). No se cambió nada.');
  }

  const cambios = [];
  const guild = interaction.guild;
  const cambiaNombre = nombre !== serie.nombre;

  // ¿El nombre nuevo ya lo usa otra serie o rol?
  if (cambiaNombre) {
    const { data: otras, error } = await db.from('series').select('id, nombre').neq('id', serie.id);
    if (error) throw error;
    const choca = otras.some((o) => o.nombre.toLowerCase() === nombre.toLowerCase())
      || guild.roles.cache.some((r) => r.id !== serie.rol_id && r.name.toLowerCase() === nombre.toLowerCase());
    if (choca) return form.editReply(`❌ Ya existe otra serie o rol llamado **${nombre}**. No se cambió nada.`);
  }

  // --- Nueva portada (opcional) ---
  let portadaUrl = serie.portada_url;
  if (portada) {
    const res = await fetch(portada.url);
    if (!res.ok) return form.editReply('❌ No pude descargar la nueva portada. No se cambió nada.');
    const ext = (portada.name.split('.').pop() || 'png').toLowerCase();
    const ruta = `portadas/${serie.id}-${Date.now()}.${ext}`;
    const { error } = await db.storage.from(BUCKET)
      .upload(ruta, Buffer.from(await res.arrayBuffer()), { contentType: portada.contentType, upsert: true });
    if (error) throw error;
    portadaUrl = db.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;

    // Borrar la portada anterior
    const rutaVieja = serie.portada_url?.split(`/${BUCKET}/`)[1];
    if (rutaVieja) await db.storage.from(BUCKET).remove([rutaVieja]);
    cambios.push('portada');
  }

  // --- Guardar en la base ---
  const nueva = { ...serie, nombre, sinopsis, drive_link: drive, portada_url: portadaUrl };
  const { error: errUpdate } = await db.from('series')
    .update({ nombre, sinopsis, drive_link: drive, portada_url: portadaUrl }).eq('id', serie.id);
  if (errUpdate) throw errUpdate;

  if (cambiaNombre) cambios.push(`nombre (**${serie.nombre}** → **${nombre}**)`);
  if (sinopsis !== (serie.sinopsis ?? null)) cambios.push('sinopsis');
  if (drive !== (serie.drive_link ?? null)) cambios.push('link de raws');

  if (!cambios.length) return form.editReply('ℹ️ No hubo cambios.');

  // --- Discord: rol, canal y ficha ---
  const avisos = [];
  if (cambiaNombre) {
    const rol = await guild.roles.fetch(serie.rol_id).catch(() => null);
    if (rol) await rol.setName(nombre, 'Corrección de nombre de serie');
    else avisos.push('No encontré el rol de la serie para renombrarlo.');

    // Discord solo permite renombrar un canal 2 veces cada 10 minutos
    const canal = await guild.channels.fetch(serie.canal_id).catch(() => null);
    if (canal) {
      const r = await Promise.race([canal.setName(nombre, 'Corrección de nombre de serie'), esperar(8000)]);
      if (r === 'timeout') avisos.push('Discord limita los cambios de nombre de canal: el canal se renombrará solo en unos minutos.');
    }
  }

  const canalSerie = await guild.channels.fetch(serie.canal_id).catch(() => null);
  if (canalSerie) {
    const ficha = await buscarFicha(canalSerie).catch(() => null);
    if (ficha) {
      await ficha.edit(construirFicha(nueva));
    } else {
      const nuevaFicha = await canalSerie.send(construirFicha(nueva));
      await nuevaFicha.pin().catch(() => {});
    }
  }

  await form.editReply(
    `✅ **${nombre}** actualizada: ${cambios.join(', ')}.`
    + (avisos.length ? `\n⚠️ ${avisos.join('\n⚠️ ')}` : ''),
  );
}