// The bridge's own SQLite file. It holds only mapping and state, never post bodies:
// which Reddit item became which forum topic, who is linked to which Discord account,
// Buy Me a Coffee membership state per email, and an audit log of every write.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS sync_map (
  reddit_id   TEXT PRIMARY KEY,          -- fullname, t3_xxx (post) or t1_xxx (comment)
  origin      TEXT NOT NULL,             -- 'reddit' (ingested) or 'forum' (published)
  tid         INTEGER,
  pid         INTEGER,
  uid         INTEGER,                   -- forum author, for topics published from the forum
  content_hash TEXT,
  state       TEXT NOT NULL DEFAULT 'live', -- live | removed_on_reddit | removed_on_forum | gone
  created_at  INTEGER NOT NULL,
  checked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS sync_map_tid ON sync_map(tid);
CREATE INDEX IF NOT EXISTS sync_map_pid ON sync_map(pid);

CREATE TABLE IF NOT EXISTS user_links (
  uid        INTEGER PRIMARY KEY,
  discord_id TEXT UNIQUE,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bmc_members (
  email      TEXT PRIMARY KEY,           -- lower-cased
  level      TEXT,                       -- membership level name from Buy Me a Coffee
  active     INTEGER NOT NULL,
  active_until INTEGER,                  -- unix seconds; a cancelled membership runs to here
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tiers (
  uid        INTEGER PRIMARY KEY,
  tier       TEXT NOT NULL,
  source     TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS seen_events (
  id         TEXT PRIMARY KEY,
  at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
`);

// Added after the first release: the Buy Me a Coffee level id (names can be renamed).
if (!db.prepare('PRAGMA table_info(bmc_members)').all().some((c) => c.name === 'level_id')) {
  db.exec('ALTER TABLE bmc_members ADD COLUMN level_id TEXT');
}

export const now = () => Math.floor(Date.now() / 1000);

export const kv = {
  get: (key) => db.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null,
  set: (key, value) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value)),
};

export function audit(action, detail = {}) {
  db.prepare('INSERT INTO audit (at, action, detail) VALUES (?, ?, ?)').run(now(), action, JSON.stringify(detail));
  console.log(`[bridge] ${action}`, JSON.stringify(detail));
}

// Returns true the first time an id is seen; webhooks are retried, so handlers use this.
export function firstTime(id) {
  return db.prepare('INSERT OR IGNORE INTO seen_events (id, at) VALUES (?, ?)').run(id, now()).changes === 1;
}

export const syncMap = {
  get: (redditId) => db.prepare('SELECT * FROM sync_map WHERE reddit_id = ?').get(redditId),
  byTid: (tid) => db.prepare("SELECT * FROM sync_map WHERE tid = ? AND reddit_id LIKE 't3_%'").get(tid),
  byPid: (pid) => db.prepare('SELECT * FROM sync_map WHERE pid = ?').get(pid),
  add: (row) =>
    db.prepare(`INSERT OR IGNORE INTO sync_map (reddit_id, origin, tid, pid, uid, content_hash, state, created_at, checked_at)
                VALUES (@reddit_id, @origin, @tid, @pid, @uid, @content_hash, 'live', @created_at, @created_at)`)
      .run({ content_hash: null, pid: null, uid: null, created_at: now(), ...row }),
  byUid: (uid) => db.prepare("SELECT * FROM sync_map WHERE uid = ? AND origin = 'forum' AND state = 'live'").all(uid),
  setState: (redditId, state) => db.prepare('UPDATE sync_map SET state = ?, checked_at = ? WHERE reddit_id = ?').run(state, now(), redditId),
  setHash: (redditId, hash) => db.prepare('UPDATE sync_map SET content_hash = ?, checked_at = ? WHERE reddit_id = ?').run(hash, now(), redditId),
  recent: (sinceSeconds) => db.prepare('SELECT * FROM sync_map WHERE created_at >= ? AND state != ? ORDER BY created_at DESC').all(now() - sinceSeconds, 'gone'),
};
