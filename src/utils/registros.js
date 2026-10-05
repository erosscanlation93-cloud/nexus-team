import { db } from '../db.js';

// Trae registros con nombre de colaborador y serie. Pagina de 1000 en 1000 (límite de Supabase).
export async function obtenerRegistros({ desde = null, hasta = null, serieId = null } = {}) {
  const todos = [];
  for (let desdeFila = 0; ; desdeFila += 1000) {
    let q = db.from('registros')
      .select('id, capitulo, rol, link, creado_en, discord_id, colaboradores(nombre), series(nombre, activa)')
      .order('creado_en', { ascending: true })
      .order('id', { ascending: true })
      .range(desdeFila, desdeFila + 999);
    if (desde) q = q.gte('creado_en', desde.toISOString());
    if (hasta) q = q.lt('creado_en', hasta.toISOString());
    if (serieId) q = q.eq('serie_id', serieId);

    const { data, error } = await q;
    if (error) throw error;
    todos.push(...data);
    if (data.length < 1000) break;
  }
  return todos;
}

// Orden fijo de roles para mostrar (los que no estén aquí van al final)
export const ORDEN_ROLES = ['TL', 'CL', 'RD', 'TP'];
export const ordenarRoles = (roles) => [...roles].sort((a, b) => {
  const ia = ORDEN_ROLES.indexOf(a); const ib = ORDEN_ROLES.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
});
