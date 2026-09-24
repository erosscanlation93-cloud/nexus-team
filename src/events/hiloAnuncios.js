import { Events } from 'discord.js';
import { db } from '../db.js';
import { formatearCapitulos } from '../utils/capitulos.js';

const BUCKET = 'imagenes';

// "368" · "361-365" · "Cap 368" · "12.5" → { desde, hasta }
function leerCapitulos(texto) {
  const m = texto.match(/(\d+(?:\.\d)?)(?:\s*-\s*(\d+(?:\.\d)?))?/);
  if (!m) return null;
  const desde = Number(m[1]);
  const hasta = m[2] ? Number(m[2]) : desde;
  if (desde > hasta || hasta - desde > 150) return null;
  return { desde, hasta };
}

async function avisar(message, texto) {
  const aviso = await message.reply({ content: texto, allowedMentions: { repliedUser: true } }).catch(() => null);
  setTimeout(() => aviso?.delete().catch(() => {}), 15_000); // se borra solo para no ensuciar el hilo
}

export function registrarHiloAnuncios(client) {
  // --- Imagen nueva en un hilo "Anuncios" ---
  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author.bot || !message.channel.isThread()) return;

      const { data: serie, error } = await db.from('series')
        .select('id, nombre').eq('hilo_id', message.channel.id).maybeSingle();
      if (error) throw error;
      if (!serie) return; // no es un hilo de anuncios

      const imagenes = message.attachments.filter((a) => a.contentType?.startsWith('image/'));
      if (!imagenes.size) return; // mensajes sin imagen se ignoran

      const caps = leerCapitulos(message.content);
      if (!caps) {
        await message.react('❌').catch(() => {});
        return avisar(message, '⚠️ Escribe el número de capítulo junto con la imagen. Ej: `368` o `361-365`. Vuelve a subirla.');
      }

      // Copiar la imagen a Supabase Storage (los links de Discord caducan)
      const img = imagenes.first();
      const res = await fetch(img.url);
      if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const ext = img.contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      const ruta = `anuncios/${serie.id}/${caps.desde}-${caps.hasta}-${message.id}.${ext}`;

      const { error: errSubida } = await db.storage.from(BUCKET)
        .upload(ruta, buffer, { contentType: img.contentType, upsert: true });
      if (errSubida) throw errSubida;
      const url = db.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;

      const { error: errInsert } = await db.from('imagenes_anuncio').insert({
        serie_id: serie.id,
        cap_desde: caps.desde,
        cap_hasta: caps.hasta,
        imagen_url: url,
        mensaje_id: message.id,
        subido_por: message.author.id,
      });
      if (errInsert) {
        await db.storage.from(BUCKET).remove([ruta]);
        throw errInsert;
      }

      await message.react('✅').catch(() => {});
      if (imagenes.size > 1) {
        avisar(message, `ℹ️ Guardé solo la primera imagen para el cap ${formatearCapitulos([caps.desde, caps.hasta])}. Sube una imagen por mensaje.`);
      }
    } catch (err) {
      console.error('❌ Error guardando imagen de anuncio:', err);
      await message.react('⚠️').catch(() => {});
    }
  });

  // --- Si borran el mensaje, se borra también la imagen guardada ---
  client.on(Events.MessageDelete, async (message) => {
    try {
      if (!message.channel?.isThread?.()) return;
      const { data: filas, error } = await db.from('imagenes_anuncio')
        .select('id, imagen_url').eq('mensaje_id', message.id);
      if (error) throw error;
      if (!filas?.length) return;

      const rutas = filas.map((f) => f.imagen_url.split(`/${BUCKET}/`)[1]).filter(Boolean);
      if (rutas.length) await db.storage.from(BUCKET).remove(rutas);
      await db.from('imagenes_anuncio').delete().in('id', filas.map((f) => f.id));
    } catch (err) {
      console.error('❌ Error borrando imagen de anuncio:', err);
    }
  });
}