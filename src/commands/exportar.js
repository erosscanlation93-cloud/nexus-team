import { SlashCommandBuilder, MessageFlags, AttachmentBuilder } from 'discord.js';
import ExcelJS from 'exceljs';
import { db } from '../db.js';
import { obtenerRegistros, ordenarRoles } from '../utils/registros.js';
import { rangoPeriodo, fechaLima, rangoCorto } from '../utils/fechas.js';

const PERIODOS = {
  todo: 'Todo el historial',
  semana_actual: 'Esta semana',
  semana_pasada: 'Semana pasada',
  mes_actual: 'Este mes',
  mes_pasado: 'Mes pasado',
};

export const permiso = 'admin';

export const data = new SlashCommandBuilder()
  .setName('exportar')
  .setDescription('Descarga los registros de trabajo en Excel')
  .addStringOption((o) => o.setName('periodo').setDescription('Periodo a exportar (por defecto: todo)')
    .addChoices(...Object.entries(PERIODOS).map(([value, name]) => ({ name, value }))))
  .addStringOption((o) => o.setName('serie').setDescription('(Opcional) Solo una serie').setAutocomplete(true));

// Sugerencias de series mientras se escribe
export async function autocomplete(interaction) {
  const texto = interaction.options.getFocused().replace(/[%_\\]/g, '\\$&');
  const { data } = await db.from('series').select('id, nombre, activa')
    .ilike('nombre', `%${texto}%`).order('nombre').limit(25);
  await interaction.respond((data ?? []).map((s) => ({
    name: `${s.nombre}${s.activa ? '' : ' (finalizada)'}`.slice(0, 100),
    value: s.id,
  })));
}

// Estilo de encabezado para cada hoja
function prepararHoja(hoja, columnas) {
  hoja.columns = columnas;
  const cabecera = hoja.getRow(1);
  cabecera.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cabecera.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const periodo = interaction.options.getString('periodo') ?? 'todo';
  const serieId = interaction.options.getString('serie');
  const { desde, hasta } = rangoPeriodo(periodo);

  let nombreSerie = null;
  if (serieId) {
    const { data: serie } = await db.from('series').select('nombre').eq('id', serieId).maybeSingle();
    if (!serie) return interaction.editReply('❌ No encontré esa serie. Elígela de la lista que aparece al escribir.');
    nombreSerie = serie.nombre;
  }

  const registros = await obtenerRegistros({ desde, hasta, serieId });
  if (!registros.length) {
    return interaction.editReply(`ℹ️ No hay registros para **${PERIODOS[periodo]}**${nombreSerie ? ` en **${nombreSerie}**` : ''}.`);
  }

  const roles = ordenarRoles(new Set(registros.map((r) => r.rol)));
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Nexus Team';

  // --- Hoja 1: detalle ---
  const detalle = libro.addWorksheet('Registros');
  prepararHoja(detalle, [
    { header: 'Fecha', key: 'fecha', width: 18 },
    { header: 'Serie', key: 'serie', width: 34 },
    { header: 'Capítulo', key: 'capitulo', width: 10 },
    { header: 'Rol', key: 'rol', width: 8 },
    { header: 'Colaborador', key: 'colaborador', width: 22 },
    { header: 'Link', key: 'link', width: 45 },
    { header: 'Estado serie', key: 'estado', width: 13 },
  ]);
  for (const r of registros) {
    detalle.addRow({
      fecha: fechaLima(r.creado_en, true),
      serie: r.series?.nombre ?? '(borrada)',
      capitulo: Number(r.capitulo),
      rol: r.rol,
      colaborador: r.colaboradores?.nombre ?? r.discord_id,
      link: r.link ?? '',
      estado: r.series?.activa === false ? 'Finalizada' : 'Activa',
    });
  }
  detalle.autoFilter = { from: 'A1', to: 'G1' };

  // --- Hoja 2: resumen por colaborador ---
  const porColab = new Map();
  for (const r of registros) {
    const nombre = r.colaboradores?.nombre ?? r.discord_id;
    const fila = porColab.get(r.discord_id) ?? { colaborador: nombre, total: 0, series: new Set() };
    fila[r.rol] = (fila[r.rol] ?? 0) + 1;
    fila.total += 1;
    if (r.series?.nombre) fila.series.add(r.series.nombre);
    porColab.set(r.discord_id, fila);
  }
  const resumen = libro.addWorksheet('Por colaborador');
  prepararHoja(resumen, [
    { header: 'Colaborador', key: 'colaborador', width: 22 },
    ...roles.map((rol) => ({ header: rol, key: rol, width: 8 })),
    { header: 'Total', key: 'total', width: 8 },
    { header: 'Series', key: 'series', width: 60 },
  ]);
  [...porColab.values()].sort((a, b) => b.total - a.total).forEach((f) => {
    resumen.addRow({ ...Object.fromEntries(roles.map((rol) => [rol, f[rol] ?? 0])), colaborador: f.colaborador, total: f.total, series: [...f.series].join(', ') });
  });

  // --- Hoja 3: resumen por serie ---
  const porSerie = new Map();
  for (const r of registros) {
    const nombre = r.series?.nombre ?? '(borrada)';
    const fila = porSerie.get(nombre) ?? { serie: nombre, total: 0, caps: new Set() };
    fila[r.rol] = (fila[r.rol] ?? 0) + 1;
    fila.total += 1;
    fila.caps.add(Number(r.capitulo));
    porSerie.set(nombre, fila);
  }
  const hojaSeries = libro.addWorksheet('Por serie');
  prepararHoja(hojaSeries, [
    { header: 'Serie', key: 'serie', width: 34 },
    ...roles.map((rol) => ({ header: rol, key: rol, width: 8 })),
    { header: 'Total', key: 'total', width: 8 },
    { header: 'Capítulos distintos', key: 'caps', width: 18 },
  ]);
  [...porSerie.values()].sort((a, b) => a.serie.localeCompare(b.serie)).forEach((f) => {
    hojaSeries.addRow({ ...Object.fromEntries(roles.map((rol) => [rol, f[rol] ?? 0])), serie: f.serie, total: f.total, caps: f.caps.size });
  });

  const buffer = Buffer.from(await libro.xlsx.writeBuffer());
  const sufijoSerie = nombreSerie ? `_${nombreSerie.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 30)}` : '';
  const archivo = `registros_${periodo}${sufijoSerie}_${fechaLima(new Date())}.xlsx`;

  await interaction.editReply({
    content: `📊 **${PERIODOS[periodo]}**${desde ? ` (${rangoCorto(desde, hasta)})` : ''}${nombreSerie ? ` · ${nombreSerie}` : ''}\n`
      + `${registros.length} registro(s) de ${porColab.size} colaborador(es) en ${porSerie.size} serie(s).`,
    files: [new AttachmentBuilder(buffer, { name: archivo })],
  });
}
