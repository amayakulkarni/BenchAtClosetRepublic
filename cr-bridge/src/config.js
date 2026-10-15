// All settings come from the environment (.env next to package.json, or the pm2 ecosystem
// file) plus two JSON files: config/roles.json (tiers) and config/sync.json (Reddit rules).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = (key, fallback = '') => (process.env[key] ?? '') || fallback;
const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));

export const config = {
  root,
  host: env('CR_BRIDGE_HOST', '127.0.0.1'),
  port: Number(env('CR_BRIDGE_PORT', '40007')),
  secret: env('CR_BRIDGE_SECRET'),
  adminToken: env('CR_ADMIN_TOKEN'),
  dbPath: path.resolve(root, env('CR_BRIDGE_DB', './data/bridge.db')),
  dryRun: env('CR_DRY_RUN', 'false') === 'true',

  nodebb: {
    url: env('NODEBB_URL', 'http://127.0.0.1:40006').replace(/\/$/, ''),
    publicUrl: env('NODEBB_PUBLIC_URL', env('NODEBB_URL', 'http://127.0.0.1:40006')).replace(/\/$/, ''),
    token: env('NODEBB_TOKEN'),
    bridgeUid: Number(env('CR_BRIDGE_UID', '0')),
  },

  reddit: {
    mode: env('REDDIT_MODE', 'off'), // api | rss | off
    subreddit: env('REDDIT_SUBREDDIT', 'closetrepublic'),
    clientId: env('REDDIT_CLIENT_ID'),
    clientSecret: env('REDDIT_CLIENT_SECRET'),
    username: env('REDDIT_USERNAME'),
    password: env('REDDIT_PASSWORD'),
    userAgent: env('REDDIT_USER_AGENT', 'server:closetrepublic-bridge:0.1.0 (by /u/closetrepublic)'),
    apiBase: env('REDDIT_API_BASE', 'https://oauth.reddit.com').replace(/\/$/, ''),
    authBase: env('REDDIT_AUTH_BASE', 'https://www.reddit.com').replace(/\/$/, ''),
    rssBase: env('REDDIT_RSS_BASE', 'https://www.reddit.com').replace(/\/$/, ''),
    maxPerMinute: Number(env('REDDIT_MAX_QPM', '60')),
  },

  discord: {
    token: env('DISCORD_BOT_TOKEN'),
    guildId: env('DISCORD_GUILD_ID'), // falls back to discordGuildId in config/roles.json (below)
  },

  bmc: {
    // Set when Buy Me a Coffee calls the bridge directly. When the main site forwards events
    // instead, it signs them with CR_BRIDGE_SECRET and this can stay empty.
    webhookSecret: env('BMC_WEBHOOK_SECRET'),
    acceptTestEvents: env('BMC_ACCEPT_TEST_EVENTS', 'false') === 'true',
  },

  roles: readJson(env('CR_ROLES_FILE', 'config/roles.json')),
  sync: readJson(env('CR_SYNC_FILE', 'config/sync.json')),
};

config.discord.guildId ||= config.roles.discordGuildId || '';

export function checkConfig() {
  const problems = [];
  if (!config.secret) problems.push('CR_BRIDGE_SECRET is empty');
  if (!config.nodebb.token) problems.push('NODEBB_TOKEN is empty (ACP > Settings > API Access, master token)');
  if (!config.nodebb.bridgeUid) problems.push('CR_BRIDGE_UID is empty (uid of the forum account the bridge posts as)');
  if (config.reddit.mode === 'api' && !(config.reddit.clientId && config.reddit.clientSecret && config.reddit.username && config.reddit.password)) {
    problems.push('REDDIT_MODE=api needs REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD');
  }
  if (config.reddit.mode !== 'off' && config.sync.ingest?.enabled && !config.sync.ingest.defaultCid) {
    problems.push('config/sync.json: set ingest.defaultCid to the forum category for Reddit copies');
  }
  const ranks = config.roles.tiers.map((t) => t.rank);
  if (new Set(ranks).size !== ranks.length) problems.push('config/roles.json: two tiers share a rank');
  return problems;
}
