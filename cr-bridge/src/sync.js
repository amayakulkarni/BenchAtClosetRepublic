// Reddit <-> forum sync.
//
// Ingest (Reddit → forum, polling): new r/<sub> posts become forum topics in a "From Reddit"
//   category: title, a short excerpt and a link back. Reddit has no webhooks, so this polls.
// Publish (forum → Reddit, event-driven): a forum topic is shared to Reddit only when its
//   author tags it with the consent tag (default "share-to-reddit") in an allowed public
//   category. The bot posts a link to the forum topic; the author's name never goes to Reddit.
// Reconcile (both ways, polling): removals and deletions follow the content. Removed on Reddit
//   → the forum copy is hidden. Deleted on the forum → the Reddit link post is deleted.
import crypto from 'node:crypto';
import { config } from './config.js';
import { syncMap, audit, now, db } from './db.js';
import { nodebb } from './nodebb.js';
import { reddit, removalReason } from './reddit.js';

const S = () => config.sync;
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const redditUrl = (permalink) => `https://www.reddit.com${permalink}`;

export function renderRedditPost(p, opts = S().ingest) {
  const max = opts.excerptChars ?? 600;
  let text = String(p.selftext || '').trim();
  if (text.length > max) text = `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
  const external = p.url && !p.is_self && !/reddit\.com|redd\.it/.test(p.url) ? `\n\n<${p.url}>` : '';
  const who = opts.author === 'shown' && p.author ? `Posted by u/${p.author} on r/${config.reddit.subreddit}` : `Shared from r/${config.reddit.subreddit}`;
  return `${text || '_(no text)_'}${external}\n\n---\n*${who}. [Read the full post and reply on Reddit](${redditUrl(p.permalink)})*`;
}

export function renderRedditComment(c, opts = S().ingest) {
  const who = opts.author === 'shown' ? `u/${c.author}` : 'A Redditor';
  return `${c.body}\n\n*${who} on [Reddit](${redditUrl(c.permalink)})*`;
}

const forumTitle = (title) => (title.length < 3 ? `${title} (Reddit)` : title).slice(0, 250);

export function shouldIngest(p, t = now(), opts = S().ingest) {
  if (syncMap.get(p.name)) return 'already synced';
  if (config.reddit.username && p.author?.toLowerCase() === config.reddit.username.toLowerCase()) return 'our own crosspost';
  if (p.created_utc < t - (opts.maxAgeHours ?? 48) * 3600) return 'too old';
  // Give AutoModerator and moderators time to act before anything is copied.
  if (p.created_utc > t - (opts.minAgeMinutes ?? 10) * 60) return 'too new';
  if (p.over_18 && !opts.allowNsfw) return 'nsfw';
  if (p.link_flair_text && (opts.skipFlairs || []).includes(p.link_flair_text)) return 'skipped flair';
  if (removalReason(p)) return 'removed';
  return null;
}

// ---------------------------------------------------------------- ingest

export async function ingest() {
  const opts = S().ingest;
  if (!opts.enabled || config.reddit.mode === 'off') return { skipped: 'ingest off' };
  const posts = (await reddit.newPosts(50)).sort((a, b) => a.created_utc - b.created_utc);
  let created = 0;
  for (const p of posts) {
    const why = shouldIngest(p);
    if (why) continue;
    const cid = (p.link_flair_text && opts.flairToCid?.[p.link_flair_text]) || opts.defaultCid;
    const content = renderRedditPost(p);
    const res = await nodebb.createTopic({ cid, title: forumTitle(p.title), content, tags: opts.tags || [] });
    if (res.dryRun) continue;
    syncMap.add({ reddit_id: p.name, origin: 'reddit', tid: res.tid, pid: res.mainPid, content_hash: hash(content) });
    audit('ingest.post', { reddit: p.name, tid: res.tid, cid });
    created++;
  }
  if (opts.mirrorComments && config.reddit.mode === 'api') created += await ingestComments();
  return { seen: posts.length, created };
}

async function ingestComments() {
  const opts = S().ingest;
  let created = 0;
  const posts = syncMap.recent((opts.commentWindowHours ?? 72) * 3600).filter((r) => r.origin === 'reddit' && r.reddit_id.startsWith('t3_') && r.state === 'live');
  for (const row of posts) {
    for (const c of await reddit.comments(row.reddit_id.slice(3))) {
      if (syncMap.get(c.name) || removalReason(c) || c.author === config.reddit.username) continue;
      const parent = c.parent_id?.startsWith('t1_') ? syncMap.get(c.parent_id) : null;
      const content = renderRedditComment(c);
      const res = await nodebb.reply(row.tid, { content, toPid: parent?.pid });
      if (res.dryRun) continue;
      syncMap.add({ reddit_id: c.name, origin: 'reddit', tid: row.tid, pid: res.pid, content_hash: hash(content) });
      created++;
    }
  }
  return created;
}

// ---------------------------------------------------------------- publish

export async function publishTopic(tid) {
  const opts = S().publish;
  if (!opts.enabled || config.reddit.mode !== 'api') return { skipped: 'publish off' };
  if (syncMap.byTid(tid)) return { skipped: 'already synced' };
  const topic = await nodebb.getTopic(tid);
  const tags = (topic.tags || []).map((t) => (typeof t === 'string' ? t : t.value));
  if (!tags.includes(opts.consentTag)) return { skipped: 'no consent tag' };
  if (!(opts.cids || []).map(Number).includes(Number(topic.cid))) return { skipped: 'category not shared to Reddit' };
  if (topic.deleted) return { skipped: 'deleted' };

  // Optional: only paid tiers from minTier up may share to Reddit (null = any member).
  const minRank = opts.minTier ? config.roles.tiers.find((t) => t.key === opts.minTier)?.rank ?? 0 : -1;
  const authorTier = db.prepare('SELECT tier FROM tiers WHERE uid = ?').get(topic.uid)?.tier;
  const authorRank = config.roles.tiers.find((t) => t.key === authorTier)?.rank ?? -1;
  if (authorRank < minRank) {
    audit('publish.skipped', { tid, reason: `author tier below ${opts.minTier}` });
    return { skipped: 'author tier too low' };
  }

  const url = `${config.nodebb.publicUrl}/topic/${topic.slug || tid}`;
  if (config.dryRun) {
    audit('dry-run:reddit.submit', { tid, url });
    return { dryRun: true };
  }
  const name = await reddit.submitLink({ title: `${opts.titlePrefix || ''}${topic.title}`, url, flairId: opts.flairId });
  syncMap.add({ reddit_id: name, origin: 'forum', tid: Number(tid), pid: topic.mainPid, uid: topic.uid });
  audit('publish.post', { tid, reddit: name });
  return { published: name };
}

// ---------------------------------------------------------------- events from the forum

export async function onForumDelete({ tid, pid, kind }) {
  const row = kind === 'topic' ? syncMap.byTid(tid) : syncMap.byPid(pid);
  if (!row || row.state !== 'live') return;
  if (row.origin === 'forum') {
    if (config.dryRun) return audit('dry-run:reddit.remove', { reddit: row.reddit_id });
    await reddit.remove(row.reddit_id);
    syncMap.setState(row.reddit_id, 'removed_on_forum');
    audit('reconcile.forum-deleted', { tid, reddit: row.reddit_id, action: 'deleted Reddit link post' });
  } else {
    // A forum moderator hid a copy of a Reddit post. The bridge is not a Reddit moderator, so
    // it only records it; the mod log on Reddit is the place to act if the post breaks rules.
    syncMap.setState(row.reddit_id, 'removed_on_forum');
    audit('reconcile.forum-hid-mirror', { tid, pid, reddit: row.reddit_id });
  }
}

export async function onForumRestore({ tid, pid, kind }) {
  const row = kind === 'topic' ? syncMap.byTid(tid) : syncMap.byPid(pid);
  if (row?.origin === 'reddit' && row.state === 'removed_on_forum') syncMap.setState(row.reddit_id, 'live');
}

// The author of a forum account was deleted: take their shared posts off Reddit too.
export async function onUserDeleted(uid) {
  for (const row of syncMap.byUid(uid)) {
    if (!config.dryRun) await reddit.remove(row.reddit_id).catch((err) => console.error('[bridge]', err.message));
    syncMap.setState(row.reddit_id, 'gone');
    audit('reconcile.user-deleted', { reddit: row.reddit_id });
  }
}

// ---------------------------------------------------------------- reconcile

export async function reconcile() {
  const rows = syncMap.recent((S().reconcile?.windowDays ?? 14) * 86400);
  const result = { checked: rows.length, hidden: 0, restored: 0, edited: 0, removedOnReddit: 0 };

  if (config.reddit.mode === 'api' && rows.length) {
    const things = Object.fromEntries((await reddit.info(rows.map((r) => r.reddit_id))).map((t) => [t.name, t]));
    for (const row of rows) {
      const thing = things[row.reddit_id];
      const gone = removalReason(thing);
      if (row.origin === 'reddit') {
        if (gone && row.state === 'live') {
          await (row.reddit_id.startsWith('t3_') ? nodebb.deleteTopic(row.tid) : nodebb.deletePost(row.pid));
          if (!config.dryRun) syncMap.setState(row.reddit_id, 'removed_on_reddit');
          audit('reconcile.reddit-removed', { reddit: row.reddit_id, tid: row.tid, reason: gone });
          result.hidden++;
        } else if (!gone && thing) {
          if (row.state === 'removed_on_reddit') {
            // Moderators approved it again.
            await (row.reddit_id.startsWith('t3_') ? nodebb.restoreTopic(row.tid) : nodebb.restorePost(row.pid));
            if (!config.dryRun) syncMap.setState(row.reddit_id, 'live');
            audit('reconcile.reddit-approved', { reddit: row.reddit_id, tid: row.tid });
            result.restored++;
          }
          if (row.state === 'live' || row.state === 'removed_on_reddit') {
            const content = row.reddit_id.startsWith('t3_') ? renderRedditPost(thing) : renderRedditComment(thing);
            if (hash(content) !== row.content_hash) {
              await nodebb.editPost(row.pid, { content });
              if (!config.dryRun) syncMap.setHash(row.reddit_id, hash(content));
              result.edited++;
            }
          }
        }
      } else if (gone && row.state === 'live') {
        // Our link post was removed by Reddit moderators or admins: record it, keep the topic.
        syncMap.setState(row.reddit_id, 'removed_on_reddit');
        audit('reconcile.crosspost-removed', { reddit: row.reddit_id, tid: row.tid, reason: gone });
        result.removedOnReddit++;
      }
    }
  }

  // Catch forum deletions the plugin could not report (bridge was down).
  for (const row of rows.filter((r) => r.origin === 'forum' && r.state === 'live')) {
    const topic = await nodebb.getTopic(row.tid).catch((err) => (err.status === 404 ? { deleted: 1 } : null));
    if (topic && Number(topic.deleted) === 1) await onForumDelete({ tid: row.tid, kind: 'topic' });
  }
  return result;
}
