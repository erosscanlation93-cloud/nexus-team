// Importa los registros del bot anterior (scan-bot-v2) al Supabase nuevo.
//
//   Revisar sin guardar nada:  node scripts/importar-scan-bot-v2.js /root/respaldo-scan-bot-v2.json
//   Importar de verdad:        node scripts/importar-scan-bot-v2.js /root/respaldo-scan-bot-v2.json --importar
//
// Se puede ejecutar varias veces: no duplica nada.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { db } from '../src/db.js';

const ruta = process.argv[2];
const IMPORTAR = process.argv.includes('--importar');
if (!ruta) {
  console.error('Uso: node scripts/importar-scan-bot-v2.js RUTA_DEL_JSON [--importar]');
  process.exit(1);
}

// Roles del bot viejo → roles del bot nuevo (se compara en minúsculas)
const MAPA_ROLES = {
  typer: 'TP', tp: 'TP', typeo: 'TP', editor: 'TP',
  traductor: 'TL', tl: 'TL', traduccion: 'TL', 'traducción': 'TL',
  cleaner: 'CL', cl: 'CL', limpieza: 'CL', 'cl/rd': 'CL',
  redrawer: 'RD', rd: 'RD', redibujo: 'RD',
};

const datos = JSON.parse(readFileSync(ruta, 'utf8'));
const series = datos.series ?? [];
const personal = datos.personal ?? [];
const capitulos = datos.capitulos ?? [];

// ---------- Análisis ----------
const personaPorId = new Map(personal.map((p) => [p.id, p]));
const seriePorId = new Map(series.map((s) => [s.id, s]));

const conteoRoles = {};
for (const c of capitulos) conteoRoles[c.rol] = (conteoRoles[c.rol] ?? 0) + 1;
const rolesDesconocidos = Object.keys(conteoRoles).filter((r) => !MAPA_ROLES[String(r).toLowerCase()]);

const sinDiscord = personal.filter((p) => !p.discordId);
const huerfanos = capitulos.filter((c) => !seriePorId.has(c.serieId) || !personaPorId.has(c.personalId));
const tp = capitulos.filter((c) => MAPA_ROLES[String(c.rol).toLowerCase()] === 'TP');
const tpSubidos = tp.filter((c) => c.subido).length;

// Series que ya existen en el bot nuevo (mismo nombre)
const { data: actuales, error: errSeries } = await db.from('series').select('id, nombre, activa');
if (errSeries) throw errSeries;
const actualPorNombre = new Map(actuales.map((s) => [s.nombre.trim().toLowerCase(), s]));
const coinciden = series.filter((s) => actualPorNombre.has(s.nombre.trim().toLowerCase()));

console.log('\n===== RESUMEN DEL RESPALDO =====');
console.log(`Series: ${series.length} · Personas: ${personal.length} · Registros: ${capitulos.length}`);
console.log('\nRoles encontrados:');
for (const [rol, n] of Object.entries(conteoRoles)) {
  const nuevo = MAPA_ROLES[String(rol).toLowerCase()];
  console.log(`  ${rol.padEnd(14)} ${String(n).padStart(5)}  →  ${nuevo ?? '❓ SIN EQUIVALENCIA'}`);
}
console.log(`\nTP marcados como subidos: ${tpSubidos} de ${tp.length}`);
console.log(`Personas sin Discord ID: ${sinDiscord.length}${sinDiscord.length ? ' → ' + sinDiscord.map((p) => p.nombre).join(', ') : ''}`);
console.log(`Registros con serie o persona inexistente (se omiten): ${huerfanos.length}`);
console.log(`\nSeries que ya existen en el bot nuevo (se unirán a ellas): ${coinciden.length}`);
for (const s of coinciden) console.log(`  · ${s.nombre}`);
console.log(`Series que se crearán como FINALIZADAS: ${series.length - coinciden.length}`);

if (rolesDesconocidos.length) {
  console.log(`\n❌ Hay roles sin equivalencia: ${rolesDesconocidos.join(', ')}. Avísame cuáles son para agregarlos.`);
  process.exit(1);
}
if (!IMPORTAR) {
  console.log('\nℹ️ Esto fue solo una revisión, no se guardó nada. Para importar, agrega --importar al final.\n');
  process.exit(0);
}

// ---------- Importación ----------
console.log('\n===== IMPORTANDO =====');
const enLotes = async (filas, fn, tam = 500) => {
  for (let i = 0; i < filas.length; i += tam) await fn(filas.slice(i, i + tam));
};

// 1. Series: usar la existente o crear una finalizada
const serieNueva = new Map(); // id viejo → id nuevo
for (const s of series) {
  const existente = actualPorNombre.get(s.nombre.trim().toLowerCase());
  if (existente) { serieNueva.set(s.id, existente.id); continue; }
  const { data, error } = await db.from('series').insert({
    nombre: s.nombre.trim(),
    tipo: 'N/D',
    clasificacion: 'N/D',
    activa: false,
    creado_por: 'scan-bot-v2',
    creado_en: s.createdAt ?? new Date().toISOString(),
  }).select('id').single();
  if (error) throw error;
  serieNueva.set(s.id, data.id);
  actualPorNombre.set(s.nombre.trim().toLowerCase(), { id: data.id, nombre: s.nombre, activa: false });
}
console.log(`✅ Series listas (${series.length})`);

// 2. Colaboradores (no pisa los nombres actuales de quienes ya usan el bot nuevo)
const discordDe = (p) => p.discordId || `antiguo-${p.id}`;
await enLotes(personal.map((p) => ({ discord_id: discordDe(p), nombre: p.nombre })), async (lote) => {
  const { error } = await db.from('colaboradores').upsert(lote, { onConflict: 'discord_id', ignoreDuplicates: true });
  if (error) throw error;
});
console.log(`✅ Colaboradores listos (${personal.length})`);

// 3. Registros
const validos = capitulos.filter((c) => seriePorId.has(c.serieId) && personaPorId.has(c.personalId));
const filas = validos.map((c) => ({
  serie_id: serieNueva.get(c.serieId),
  capitulo: Number(c.numero),
  rol: MAPA_ROLES[String(c.rol).toLowerCase()],
  discord_id: discordDe(personaPorId.get(c.personalId)),
  creado_en: c.createdAt,
}));
let insertados = 0;
await enLotes(filas, async (lote) => {
  const { data, error } = await db.from('registros')
    .upsert(lote, { onConflict: 'serie_id,capitulo,rol,discord_id', ignoreDuplicates: true }).select('id');
  if (error) throw error;
  insertados += data.length;
});
console.log(`✅ Registros importados: ${insertados} (${filas.length - insertados} ya existían o estaban repetidos)`);

// 4. TP ya subidos → marcados como publicados, para que no aparezcan como pendientes en /publicar
const publicados = validos
  .filter((c) => c.subido && MAPA_ROLES[String(c.rol).toLowerCase()] === 'TP')
  .map((c) => ({
    serie_id: serieNueva.get(c.serieId),
    capitulo: Number(c.numero),
    acceso: 'gratis',
    publicado_por: 'scan-bot-v2',
    publicado_en: c.createdAt,
  }));
await enLotes(publicados, async (lote) => {
  const { error } = await db.from('publicaciones')
    .upsert(lote, { onConflict: 'serie_id,capitulo,acceso', ignoreDuplicates: true });
  if (error) throw error;
});
console.log(`✅ Capítulos marcados como ya publicados: ${publicados.length}`);
console.log('\n🎉 Importación terminada.\n');