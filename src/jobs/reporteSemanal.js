import { EmbedBuilder } from 'discord.js';
import { db } from '../db.js';
import { obtenerRegistros, ordenarRoles } from '../utils/registros.js';
import { inicioSemana, sumarDias, fechaLima, rangoCorto } from '../utils/fechas.js';

const INTERVALO_MIN = 10;
let miembrosCargados = false;
let enCurso = false;

// Arranca el reporte: se actualiza al iniciar y cada 10 minutos
export function iniciarReporteSemanal(client) {
  if (!process.env.CANAL_AVANCE_ID) {
    console.log('ℹ️ Reporte semanal desactivado (falta CANAL_AVANCE_ID en el .env)');
    return;
  }
  const tick = () => actualizarReporte(client).catch((e) => console.error('❌ Reporte semanal:', e));
  tick();
  setInterval(tick, INTERVALO_MIN * 60_000);
}

export async function actualizarReporte(client) {
  if (enCurso) return;
  enCurso = true;
  try {
    const canal = await client.channels.fetch(process.env.CANAL_AVANCE_ID).catch(() => null);
    if (!canal) return console.warn('⚠️ Reporte semanal: no encuentro el canal CANAL_AVANCE_ID');

    const inicio = inicioSemana();
    const clave = fechaLima(inicio);
    const { data: actual, error } = await db.from('reportes_semanales').select('*').eq('semana_inicio', clave).maybeSingle();
    if (error) throw error;

    if (!actual) {
      // Semana nueva: dejar la anterior con sus números finales y crear el mensaje de esta semana
      const inicioAnterior = sumarDias(inicio, -7);
      const { data: anterior } = await db.from('reportes_semanales')
        .select('*').eq('semana_inicio', fechaLima(inicioAnterior)).maybeSingle();
      if (anterior) {
        const viejo = await canal.messages.fetch(anterior.mensaje_id).catch(() => null);
        await viejo?.edit(await construirReporte(canal.guild, inicioAnterior, true));
      }
      const nuevo = await canal.send(await construirReporte(canal.guild, inicio, false));
      await db.from('reportes_semanales').insert({ semana_inicio: clave, mensaje_id: nuevo.id, canal_id: canal.id });
      return;
    }

    const contenido = await construirReporte(canal.guild, inicio, false);
    const mensaje = await canal.messages.fetch(actual.mensaje_id).catch(() => null);
    if (mensaje) {
      await mensaje.edit(contenido);
    } else {
      // Si alguien borró el mensaje, se vuelve a crear
      const nuevo = await canal.send(contenido);
      await db.from('reportes_semanales').update({ mensaje_id: nuevo.id }).eq('semana_inicio', clave);
    }
  } finally {
    enCurso = false;
  }
}

async function construirReporte(guild, inicio, cerrada) {
  const fin = sumarDias(inicio, 7);
  const registros = await obtenerRegistros({ desde: inicio, hasta: fin });

  // Todos los miembros del scan, para mostrar también a quienes no registraron nada
  if (!miembrosCargados) {
    await guild.members.fetch();
    miembrosCargados = true;
  }
  const rolMiembros = guild.roles.cache.get(process.env.ROL_MIEMBROS_ID);
  const stats = new Map();
  for (const m of rolMiembros?.members.values() ?? []) {
    if (!m.user.bot) stats.set(m.id, { nombre: m.displayName, conteo: {}, total: 0 });
  }
  for (const r of registros) {
    const s = stats.get(r.discord_id) ?? { nombre: r.colaboradores?.nombre ?? r.discord_id, conteo: {}, total: 0 };
    s.conteo[r.rol] = (s.conteo[r.rol] ?? 0) + 1;
    s.total += 1;
    stats.set(r.discord_id, s);
  }

  const lista = [...stats.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
  const activos = lista.filter((s) => s.total > 0);
  const inactivos = lista.filter((s) => s.total === 0);
  const medallas = ['🥇', '🥈', '🥉'];

  const lineas = [];
  lineas.push(`**${activos.length}** con avance · **${inactivos.length}** sin registros · **${registros.length}** registros en total`, '');
  if (activos.length) {
    lineas.push('### ✅ Con avance');
    activos.forEach((s, i) => {
      const detalle = ordenarRoles(Object.keys(s.conteo)).map((rol) => `${rol} ${s.conteo[rol]}`).join(' · ');
      lineas.push(`${medallas[i] ?? `\`${i + 1}.\``} **${s.nombre}** — ${s.total} trabajo${s.total === 1 ? "" : "s"} · ${detalle}`);
    });
  }
  if (inactivos.length) {
    lineas.push('', '### ❌ Sin registros esta semana');
    lineas.push(inactivos.map((s) => s.nombre).join(' · '));
  }
  if (!lista.length) lineas.push('Todavía no hay registros esta semana.');

  // Partir en varios embeds si la lista es muy larga (límite de Discord: 4096 caracteres)
  const bloques = [''];
  for (const linea of lineas) {
    if ((bloques.at(-1) + linea).length > 3900) bloques.push('');
    bloques[bloques.length - 1] += `${linea}\n`;
  }

  const titulo = `📊 Avance semanal · ${rangoCorto(inicio, fin)}${cerrada ? ' · CERRADA' : ''}`;
  const embeds = bloques.slice(0, 10).map((texto, i) => {
    const e = new EmbedBuilder().setColor(cerrada ? 0x64748b : 0x9b5cff).setDescription(texto);
    if (i === 0) e.setTitle(titulo);
    return e;
  });
  embeds.at(-1).setFooter({
    text: cerrada ? 'Semana cerrada' : `Se actualiza cada ${INTERVALO_MIN} min · Última actualización ${fechaLima(new Date(), true).slice(11)} (Lima)`,
  });

  return { embeds };
}
