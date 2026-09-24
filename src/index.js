import 'dotenv/config';
import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { loadCommands } from './utils/loadCommands.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = await loadCommands();

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Conectado como ${c.user.tag}`);
  const guild = c.guilds.cache.get(process.env.GUILD_ID);
  console.log(guild
    ? `📡 Servidor encontrado: ${guild.name}`
    : '⚠️ No encuentro el servidor, revisa GUILD_ID en el .env');
  console.log(`🧩 Comandos cargados: ${[...client.commands.keys()].join(', ') || 'ninguno'}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Autocompletado (lo usaremos para elegir series)
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) await command.autocomplete(interaction).catch(console.error);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`❌ Error en /${interaction.commandName}:`, err);
    const msg = { content: '❌ Ocurrió un error al ejecutar el comando.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);