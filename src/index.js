import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Conectado como ${c.user.tag}`);
  const guild = c.guilds.cache.get(process.env.GUILD_ID);
  console.log(guild
    ? `📡 Servidor encontrado: ${guild.name}`
    : '⚠️ No encuentro el servidor, revisa GUILD_ID en el .env');
});

client.login(process.env.DISCORD_TOKEN);
