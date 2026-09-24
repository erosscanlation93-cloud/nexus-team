const MAX_CAPITULOS = 150;

// "12, 15, 20-25, 30.5" → [12, 15, 20, 21, 22, 23, 24, 25, 30.5]
export function parsearCapitulos(texto) {
  const resultado = new Set();
  const partes = texto.split(',').map((p) => p.trim()).filter(Boolean);
  if (!partes.length) throw new Error('No escribiste ningún capítulo.');

  for (const parte of partes) {
    const rango = parte.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rango) {
      const desde = Number(rango[1]);
      const hasta = Number(rango[2]);
      if (desde > hasta) throw new Error(`El rango **${parte}** está al revés.`);
      if (hasta - desde + 1 > MAX_CAPITULOS) throw new Error(`El rango **${parte}** es demasiado grande.`);
      for (let c = desde; c <= hasta; c++) resultado.add(c);
    } else if (/^\d+(\.\d)?$/.test(parte)) {
      resultado.add(Number(parte));
    } else {
      throw new Error(`No entiendo **${parte}**. Usa números, comas y guiones. Ej: \`12, 15, 20-25\``);
    }
  }

  if (resultado.size > MAX_CAPITULOS) throw new Error(`Máximo ${MAX_CAPITULOS} capítulos por registro.`);
  return [...resultado].sort((a, b) => a - b);
}

// [20, 21, 22, 25, 30.5] → "20-22, 25, 30.5"
export function formatearCapitulos(caps) {
  const ordenados = [...new Set(caps.map(Number))].sort((a, b) => a - b);
  const grupos = [];
  for (const c of ordenados) {
    const ultimo = grupos.at(-1);
    if (ultimo && Number.isInteger(c) && Number.isInteger(ultimo[1]) && c === ultimo[1] + 1) ultimo[1] = c;
    else grupos.push([c, c]);
  }
  return grupos.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}