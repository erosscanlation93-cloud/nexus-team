import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lee todos los archivos de src/commands y los devuelve en un Map { nombre -> comando }
export async function loadCommands() {
  const dir = join(__dirname, '..', 'commands');
  const commands = new Map();

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    if (!mod.data || !mod.execute) {
      console.warn(`⚠️ ${file} no exporta "data" y "execute", se omite`);
      continue;
    }
    commands.set(mod.data.name, mod);
  }
  return commands;
}
