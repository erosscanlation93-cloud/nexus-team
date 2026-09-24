import { createClient } from '@supabase/supabase-js';

// Cliente de Supabase con la clave secreta (solo se usa en el bot, nunca en una web pública)
export const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});
