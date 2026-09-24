import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadCommands } from './utils/loadCommands.js';

// Registra los comandos solo en tu servidor (aparecen al instante)
const commands = await loadCommands();
const body = [...commands.values()].map((c) => c.data.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
  const data = await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body },
  );
  console.log(`✅ ${data.length} comando(s) registrado(s): ${data.map((c) => '/' + c.name).join(', ')}`);
} catch (err) {
  console.error('❌ No se pudieron registrar los comandos:', err);
}
