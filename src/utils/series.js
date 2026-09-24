import { db } from '../db.js';

// Devuelve la serie del canal donde se usó el comando.
// Funciona tanto en el canal de la serie como dentro de su hilo "Anuncios".
export async function serieDelCanal(channel) {
  const canalId = channel.isThread() ? channel.parentId : channel.id;
  const { data, error } = await db.from('series').select('*').eq('canal_id', canalId).maybeSingle();
  if (error) throw error;
  return data; // null si el canal no es de ninguna serie
}