// Watches the Discord server for role changes. Needs a bot in the server with the
// "Server Members Intent" switched on (Discord Developer Portal > Bot). The bot only reads
// roles; it never assigns them, so it cannot fight Buy Me a Coffee's own Discord integration.
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';

let client = null;
let guild = null;
let onChange = async () => {};
let onReady = async () => {};

export const discordEnabled = () => Boolean(config.discord.token && config.discord.guildId);
export const discordReady = () => Boolean(guild);
let problem = null;
export const discordProblem = () => problem;

// handler(discordId) runs on every role change; ready() runs each time the bot connects, so
// tiers are checked again for everyone (covers logins and role changes while it was offline).
export async function startDiscord(handler, ready = async () => {}) {
  if (!discordEnabled()) {
    console.log('[bridge] Discord off (DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not set)');
    return;
  }
  onChange = handler;
  onReady = ready;
  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

  client.once(Events.ClientReady, async () => {
    try {
      guild = await client.guilds.fetch(config.discord.guildId);
    } catch (err) {
      problem = `bot cannot see server ${config.discord.guildId}`;
      console.error(`[bridge] Discord: the bot cannot see server ${config.discord.guildId} (${err.message}). Invite the bot to the server and check DISCORD_GUILD_ID.`);
      return;
    }
    console.log(`[bridge] Discord connected to ${guild.name}`);
    onReady().catch((err) => console.error('[bridge] tier check after connecting failed', err.message));
  });
  const changed = (member) => onChange(member.id).catch((err) => console.error('[bridge] role sync failed', err.message));
  client.on(Events.GuildMemberUpdate, (before, after) => {
    const a = [...before.roles.cache.keys()].sort().join();
    const b = [...after.roles.cache.keys()].sort().join();
    if (a !== b) changed(after);
  });
  client.on(Events.GuildMemberAdd, changed);
  client.on(Events.GuildMemberRemove, changed);
  try {
    await client.login(config.discord.token);
  } catch (err) {
    // Keep the bridge running (Reddit, Buy Me a Coffee) when the bot cannot log in.
    const hint = /disallowed intents/i.test(err.message)
      ? 'switch on "Server Members Intent" (Discord Developer Portal > the app > Bot), then restart the bridge'
      : 'check DISCORD_BOT_TOKEN in bridge.env, then restart the bridge';
    problem = `login failed: ${hint}`;
    console.error(`[bridge] Discord login failed (${err.message}): ${hint}`);
    client = null;
  }
}

// Role ids of a Discord user in the server; [] = not a member; throws when Discord is
// configured but not connected (so nobody gets downgraded during an outage).
export async function memberRoles(discordId) {
  if (!discordEnabled()) return [];
  if (!guild) throw new Error('Discord not connected yet');
  try {
    const member = await guild.members.fetch(discordId);
    return [...member.roles.cache.keys()];
  } catch (err) {
    if (err.code === 10007 || err.code === 10013) return []; // Unknown Member / Unknown User
    throw err;
  }
}
