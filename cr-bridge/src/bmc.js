// Buy Me a Coffee membership events → bmc_members → tier recompute for the matching forum
// account. Field names vary between event types, so several spellings are accepted; check a
// "Send test" event from the Buy Me a Coffee dashboard against these if a tier never moves.
import { config } from './config.js';
import { db, now, audit, firstTime } from './db.js';
import { nodebb } from './nodebb.js';
import { applyTier, bmcStillCounts } from './roles.js';

const pick = (obj, keys) => keys.map((k) => k.split('.').reduce((o, part) => o?.[part], obj)).find((v) => v !== undefined && v !== null && v !== '');
const toSeconds = (v) => (v === undefined ? null : /^\d+$/.test(String(v)) ? Number(v) : Math.floor(Date.parse(v) / 1000) || null);

export function parseBmcEvent(event) {
  const type = String(event.type || '');
  const data = event.data || {};
  const email = String(pick(data, ['supporter_email', 'payer_email', 'email', 'supporter.email']) || '').trim().toLowerCase();
  const level = pick(data, ['membership_level_name', 'level_name', 'membership_level.name', 'membership_name']);
  const levelId = pick(data, ['membership_level_id', 'level_id', 'membership_level.id']);
  const periodEnd = toSeconds(pick(data, ['current_period_end', 'membership_end_at', 'ends_at', 'expires_at']));
  let change = null;
  if (/^membership\.(started|updated|renewed|level_?updated|resumed)$/.test(type)) change = 'active';
  else if (/^membership\.(cancell?ed|ended|expired|paused)$/.test(type)) change = 'inactive';
  return { type, email, level: level == null ? null : String(level), levelId: levelId == null ? null : String(levelId), periodEnd, change, id: `bmc:${event.event_id ?? data.id ?? ''}:${type}` };
}

export async function handleBmcEvent(event) {
  if (event.live_mode === false && !config.bmc.acceptTestEvents) return { ignored: 'test event' };
  const e = parseBmcEvent(event);
  if (!e.change) return { ignored: e.type || 'unknown event' };
  if (!e.email) return { ignored: 'no supporter email in event' };
  if (!firstTime(e.id)) return { duplicate: true };

  const existing = db.prepare('SELECT * FROM bmc_members WHERE email = ?').get(e.email);
  db.prepare(`INSERT INTO bmc_members (email, level, level_id, active, active_until, updated_at) VALUES (@email, @level, @levelId, @active, @until, @at)
              ON CONFLICT(email) DO UPDATE SET level = COALESCE(excluded.level, bmc_members.level),
              level_id = COALESCE(excluded.level_id, bmc_members.level_id), active = excluded.active,
              active_until = excluded.active_until, updated_at = excluded.updated_at`)
    .run({
      email: e.email,
      level: e.level ?? existing?.level ?? null,
      levelId: e.levelId ?? existing?.level_id ?? null,
      active: e.change === 'active' ? 1 : 0,
      // A cancelled membership keeps its tier until the paid period ends, plus graceDays.
      until: e.change === 'inactive' ? e.periodEnd ?? now() : null,
      at: now(),
    });
  audit('bmc.membership', { type: e.type, level: e.level, change: e.change }); // no email in the log

  const uid = await nodebb.uidByEmail(e.email);
  if (!uid) return { stored: true, forumAccount: false };
  const tier = await applyTier(uid, e.type);
  return { stored: true, forumAccount: true, tier: tier?.key };
}

// Cancelled memberships whose paid period and grace days have now run out.
export async function expireMemberships() {
  const rows = db.prepare('SELECT * FROM bmc_members WHERE active = 0 AND active_until IS NOT NULL').all().filter((r) => !bmcStillCounts(r));
  for (const { email } of rows) {
    db.prepare('UPDATE bmc_members SET active_until = NULL, updated_at = ? WHERE email = ?').run(now(), email);
    const uid = await nodebb.uidByEmail(email);
    if (uid) await applyTier(uid, 'membership period ended');
  }
}
