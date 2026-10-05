// Fechas en hora de Lima (UTC-5, sin horario de verano)
const OFFSET = 5 * 3600e3;
const DIA = 86400e3;

// Desplaza la fecha para que getUTC* devuelva la hora de Lima
const aLima = (d) => new Date(new Date(d).getTime() - OFFSET);

// Lunes 00:00 (Lima) de la semana de "ref"
export function inicioSemana(ref = new Date()) {
  const l = aLima(ref);
  const diasDesdeLunes = (l.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() - diasDesdeLunes) + OFFSET);
}

// Día 1 00:00 (Lima) del mes de "ref" (+delta meses)
export function inicioMes(ref = new Date(), delta = 0) {
  const l = aLima(ref);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth() + delta, 1) + OFFSET);
}

export const sumarDias = (d, n) => new Date(d.getTime() + n * DIA);

// "2026-10-05" o "2026-10-05 14:30" en hora de Lima
export function fechaLima(d, conHora = false) {
  const s = aLima(d).toISOString();
  return conHora ? s.slice(0, 16).replace('T', ' ') : s.slice(0, 10);
}

// "05/10 – 11/10" (hasta es exclusivo)
export function rangoCorto(desde, hasta) {
  const f = (d) => { const s = fechaLima(d); return `${s.slice(8, 10)}/${s.slice(5, 7)}`; };
  return `${f(desde)} – ${f(sumarDias(hasta, -1))}`;
}

// Periodos que ofrece /exportar
export function rangoPeriodo(periodo, ahora = new Date()) {
  switch (periodo) {
    case 'semana_actual': { const d = inicioSemana(ahora); return { desde: d, hasta: sumarDias(d, 7) }; }
    case 'semana_pasada': { const d = sumarDias(inicioSemana(ahora), -7); return { desde: d, hasta: sumarDias(d, 7) }; }
    case 'mes_actual': return { desde: inicioMes(ahora), hasta: inicioMes(ahora, 1) };
    case 'mes_pasado': return { desde: inicioMes(ahora, -1), hasta: inicioMes(ahora) };
    default: return { desde: null, hasta: null }; // todo
  }
}
