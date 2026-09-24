import {
  SlashCommandBuilder, ModalBuilder, LabelBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, EmbedBuilder, MessageFlags,
} from 'discord.js';
import { db } from '../db.js';
import { serieDelCanal } from '../utils/series.js';
import { parsearCapitulos, formatearCapitulos } from '../utils/capitulos.js';

// Roles de trabajo disponibles (el TP marca el capítulo como listo)
const ROLES = [
  { value: 'TL', label: 'TL', description: 'Traducción' },
  { value: 'CL', label: 'CL', description: 'Limpieza' },
  { value: 'TP', label: 'TP', description: 'Typeo / edición final' },
];

export const data = new SlashCommandBuilder()
  .setName('registrar')
  .setDescription('Registra capítulos trabajados (usar en el canal de la serie)')
  .addStringOption((o) => o.setName('capitulos').setDescription('Ej: 12  ·  12, 15  ·  20-25').setRequired(true))
  .addStringOption((o) => o.setName('link').setDescription('(Opcional) Link del Drive con el capítulo').setRequired(false));

export async function execute(interaction) {
  // --- Validaciones antes de abrir el formulario ---
  let capitulos;
  try {
    capitulos = parsearCapitulos(interaction.options.getString('capitulos', true));
  } catch (e) {
    return interaction.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral });
  }

  const link = interaction.options.getString('link')?.trim() || null;
  if (link && !/^https?:\/\/\S+$/i.test(link)) {
    return interaction.reply({ content: '❌ El link no es válido. Debe empezar con `https://`.', flags: MessageFlags.Ephemeral });
  }

  const serie = await serieDelCanal(interaction.channel);
  if (!serie) {
    return interaction.reply({ content: '❌ Usa este comando dentro del canal de una serie.', flags: MessageFlags.Ephemeral });
  }

  // --- Formulario: roles realizados ---
  const modalId = `registrar-${interaction.id}`;
  await interaction.showModal(new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(`Registrar · ${serie.nombre}`.slice(0, 45))
    .addLabelComponents(new LabelBuilder()
      .setLabel('Rol realizado')
      .setDescription(`Capítulos: ${formatearCapitulos(capitulos)}`.slice(0, 100))
      .setStringSelectMenuComponent(new StringSelectMenuBuilder()
        .setCustomId('roles')
        .setPlaceholder('Selecciona 1 o varios roles')
        .setMinValues(1)
        .setMaxValues(ROLES.length)
        .addOptions(ROLES.map((r) => new StringSelectMenuOptionBuilder()
          .setValue(r.value).setLabel(r.label).setDescription(r.description))))));

  let form;
  try {
    form = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modalId, time: 10 * 60_000 });
  } catch {
    return; // cerró el formulario o pasó el tiempo
  }
  const roles = form.fields.getStringSelectValues('roles');
  await form.deferReply();

  // --- Guardar ---
  const usuario = interaction.user;
  const nombre = interaction.member?.displayName ?? usuario.username;

  const { error: errColab } = await db.from('colaboradores')
    .upsert({ discord_id: usuario.id, nombre, actualizado_en: new Date().toISOString() });
  if (errColab) throw errColab;

  // ¿Alguien más ya registró estos capítulos con el mismo rol?
  const { data: previos, error: errPrevios } = await db.from('registros')
    .select('capitulo, rol, colaboradores(nombre)')
    .eq('serie_id', serie.id)
    .in('capitulo', capitulos)
    .in('rol', roles)
    .neq('discord_id', usuario.id);
  if (errPrevios) throw errPrevios;

  const filas = capitulos.flatMap((capitulo) => roles.map((rol) => ({
    serie_id: serie.id, capitulo, rol, discord_id: usuario.id, link,
  })));

  const { data: nuevos, error: errInsert } = await db.from('registros')
    .upsert(filas, { onConflict: 'serie_id,capitulo,rol,discord_id', ignoreDuplicates: true })
    .select('capitulo');
  if (errInsert) throw errInsert;

  // --- Respuesta ---
  const embed = new EmbedBuilder()
    .setColor(roles.includes('TP') ? 0x22c55e : 0xf59e0b)
    .setTitle(`Añadido con éxito · ${roles.join(', ')}`)
    .addFields({ name: 'Capítulos', value: formatearCapitulos(capitulos) })
    .setFooter({ text: `Registrado por ${nombre}`, iconURL: usuario.displayAvatarURL() })
    .setTimestamp();

  if (link) embed.addFields({ name: 'Link', value: link });
  if (roles.includes('TP')) embed.setDescription('✅ Listo para publicar');

  const repetidos = filas.length - (nuevos?.length ?? 0);
  if (repetidos > 0) {
    embed.addFields({ name: 'ℹ️ Aviso', value: `${repetidos} registro(s) ya los tenías y no se duplicaron.` });
  }
  if (previos?.length) {
    const detalle = previos.slice(0, 10)
      .map((p) => `Cap ${p.capitulo} · ${p.rol} → ${p.colaboradores?.nombre ?? 'otro'}`).join('\n');
    embed.addFields({ name: '⚠️ Ya registrado por otra persona', value: detalle + (previos.length > 10 ? '\n…' : '') });
  }

  await form.editReply({ embeds: [embed] });
}