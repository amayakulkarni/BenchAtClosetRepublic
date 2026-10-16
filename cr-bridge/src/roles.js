// Paid tiers, ranked by Buy Me a Coffee price (config/roles.json):
//   Alien $1 < Citizen $3 < Top 1% $5 < Upper Middle Class $6 < Middle Class $8
// A member's tier is the highest one any source gives them:
//   Discord: tier roles they hold in the Discord server (set by Buy Me a Coffee's Discord
//            integration or by moderators).
//   Buy Me a Coffee: an active membership level, matched by the email on their forum account.
//            A cancelled membership counts until its paid period ends plus graceDays.
// Members with no paid tier are in no tier group (no badge). Everyone else is in exactly one
// tier group, which sets their badge and, through category privileges, what they can see.
import { config } from './config.js';
import { db, kv, now, audit } from './db.js';
import { nodebb } from './nodebb.js';
import { memberRoles } from './discord.js';

const tiers = [...config.roles.tiers].sort((a, b) => a.rank - b.rank);
const byKey = Object.fromEntries(tiers.map((t) => [t.key, t]));
const norm = (s) => String(s || '').trim().toLowerCase();

export function tierFromDiscordRoles(roleIds, isMember) {
  let best = null;
  if (isMember && config.roles.discordMemberTier) best = byKey[config.roles.discordMemberTier];
  for (const t of tiers) {
    if ((t.discordRoleIds || []).some((id) => roleIds.includes(String(id))) && (!best || t.rank > best.rank)) best = t;
  }
  return best;
}

const graceSeconds = () => (config.roles.graceDays ?? 7) * 86400;
export const bmcStillCounts = (row, at = now()) => Boolean(row && (row.active || (row.active_until && row.active_until + graceSeconds() > at)));

export function tierFromBmc(row, at = now()) {
  if (!row) return null;
  const active = bmcStillCounts(row, at);
  if (!active) return null;
  // Level id first (survives renaming a level on Buy Me a Coffee), then the name.
  const byId = row.level_id && tiers.filter((t) => (t.bmcLevelIds || []).map(String).includes(String(row.level_id))).pop();
  const level = norm(row.level);
  const match = byId || tiers.filter((t) => (t.bmcLevels || []).map(norm).includes(level)).pop();
  return match || byKey[config.roles.bmcUnknownLevelTier] || null;
}

// null = no paid tier.
export function highest(...candidates) {
  return candidates.filter(Boolean).reduce((a, b) => (!a || b.rank > a.rank ? b : a), byKey[config.roles.defaultTier] || null);
}

// ---------------------------------------------------------------- groups in NodeBB

const slugGuess = (name) => name.toLowerCase().replace(/%/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const groupSlug = (tier) => kv.get(`group-slug:${tier.key}`) || slugGuess(tier.name);

export async function ensureGroups() {
  for (const t of tiers) {
    let slug = groupSlug(t);
    if (!(await nodebb.groupExists(slug))) {
      const created = await nodebb.createGroup({
        name: t.name,
        description: t.description || '',
        userTitle: t.userTitle || t.name,
        userTitleEnabled: 1,
        hidden: t.hidden ? 1 : 0,
        private: 1,
        disableJoinRequests: 1, // only the bridge puts people in tier groups
        disableLeave: 1,
      });
      if (created?.slug) slug = created.slug;
      audit('group.created', { tier: t.key, slug });
    }
    kv.set(`group-slug:${t.key}`, slug);
    // NodeBB makes whoever creates a group its owner and first member; the bridge account
    // should not wear every badge. Tier groups refuse leaving, so allow it for a moment
    // (this also cleans up forums set up before this fix).
    await nodebb.updateGroup(slug, { disableLeave: false });
    await nodebb.leaveGroup(slug, config.nodebb.bridgeUid).catch(() => {}); // not a member: fine
    await nodebb.updateGroup(slug, {
      userTitle: t.userTitle || t.name,
      userTitleEnabled: true,
      labelColor: t.labelColor || '#000000',
      textColor: t.textColor || '#ffffff',
      icon: t.icon || '',
      disableJoinRequests: true,
      disableLeave: true,
    });
  }
}

// ---------------------------------------------------------------- applying a tier

export const link = {
  set: (uid, discordId) =>
    db.prepare(`INSERT INTO user_links (uid, discord_id, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(uid) DO UPDATE SET discord_id = excluded.discord_id, updated_at = excluded.updated_at`).run(uid, discordId, now()),
  byDiscord: (discordId) => db.prepare('SELECT uid FROM user_links WHERE discord_id = ?').get(discordId)?.uid ?? null,
  byUid: (uid) => db.prepare('SELECT discord_id FROM user_links WHERE uid = ?').get(uid)?.discord_id ?? null,
  all: () => db.prepare('SELECT uid FROM user_links').all().map((r) => r.uid),
};

export async function computeTier(uid) {
  const discordId = link.byUid(uid);
  let fromDiscord = null;
  if (discordId) {
    const roles = await memberRoles(discordId);
    // discord.js includes the @everyone role for every member, so [] means "not in the server".
    fromDiscord = tierFromDiscordRoles(roles, roles.length > 0);
  }
  const email = await nodebb.userEmail(uid);
  const bmcRow = email ? db.prepare('SELECT * FROM bmc_members WHERE email = ?').get(email) : null;
  const fromBmc = tierFromBmc(bmcRow);
  const tier = highest(fromDiscord, fromBmc);
  const source = !tier ? 'none' : tier === fromBmc ? 'buymeacoffee' : tier === fromDiscord ? 'discord' : 'default';
  return { tier, source };
}

// force: apply even when the stored tier is unchanged (reconcile repairs badges removed by hand).
export async function applyTier(uid, reason, force = false) {
  if (!uid || uid === config.nodebb.bridgeUid) return null;
  const { tier, source } = await computeTier(uid);
  const key = tier ? tier.key : 'none';
  const current = db.prepare('SELECT tier FROM tiers WHERE uid = ?').get(uid)?.tier;
  if (current === key && !force) return tier;

  if (tier) await nodebb.joinGroup(groupSlug(tier), uid);
  for (const other of tiers) {
    if (other.key === key) continue;
    await nodebb.leaveGroup(groupSlug(other), uid).catch(() => {}); // not a member: fine
  }
  await nodebb.setGroupTitle(uid, tier ? tier.name : null);
  if (current === key) return tier;
  if (!config.dryRun) {
    db.prepare(`INSERT INTO tiers (uid, tier, source, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(uid) DO UPDATE SET tier = excluded.tier, source = excluded.source, updated_at = excluded.updated_at`)
      .run(uid, key, source, now());
  }
  audit('tier.changed', { uid, from: current || null, to: key, source, reason });
  return tier;
}

export async function applyAll(reason = 'reconcile') {
  const uids = new Set([...link.all(), ...db.prepare('SELECT uid FROM tiers').all().map((r) => r.uid)]);
  for (const uid of uids) {
    try {
      await applyTier(uid, reason, true);
    } catch (err) {
      console.error(`[bridge] tier for uid ${uid} failed:`, err.message);
    }
  }
}
