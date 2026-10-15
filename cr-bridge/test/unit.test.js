// npm test   (no network, no NodeBB needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

process.env.CR_BRIDGE_DB = path.join(os.tmpdir(), `cr-bridge-test-${process.pid}.db`);
process.env.REDDIT_USERNAME = 'closetrepublic_bot';

const { config } = await import('../src/config.js');
const { tierFromBmc, tierFromDiscordRoles, highest } = await import('../src/roles.js');
const { parseBmcEvent } = await import('../src/bmc.js');
const { parseAtom, removalReason } = await import('../src/reddit.js');
const { shouldIngest, renderRedditPost } = await import('../src/sync.js');
const { RateLimiter } = await import('../src/ratelimit.js');
const { validSignature } = await import('../src/server.js');

test('Buy Me a Coffee levels map to tiers by their exact names, case-insensitively', () => {
  assert.equal(tierFromBmc({ active: 1, level: "in dictator's bed" }).key, 'top-1');
  assert.equal(tierFromBmc({ active: 1, level: 'Middle class' }).key, 'middle-class');
  assert.equal(tierFromBmc({ active: 1, level: 'Some new level' }).key, 'alien'); // bmcUnknownLevelTier
  config.roles.tiers.find((t) => t.key === 'citizen').bmcLevelIds = ['123'];
  assert.equal(tierFromBmc({ active: 1, level: 'Renamed level', level_id: 123 }).key, 'citizen'); // id beats name
  const day = 86400;
  assert.equal(tierFromBmc({ active: 0, level: 'citizen', active_until: 1000 }, 1000 + 6 * day).key, 'citizen'); // in grace
  assert.equal(tierFromBmc({ active: 0, level: 'citizen', active_until: 1000 }, 1000 + 8 * day), null); // grace over
});

test('every tier is paid: no tier without a role or membership; price order decides', () => {
  assert.equal(tierFromDiscordRoles(['everyone'], true), null);
  assert.equal(highest(null, null), null);
  const top1 = tierFromBmc({ active: 1, level: 'Top 1%' });
  const middle = tierFromBmc({ active: 1, level: 'Middle class' });
  assert.equal(highest(top1, middle).key, 'middle-class'); // $8 outranks $5
});

test('BMC events are parsed from several field spellings', () => {
  const e = parseBmcEvent({ type: 'membership.started', event_id: 1, data: { supporter_email: 'A@B.com', membership_level_name: 'Top 1%' } });
  assert.deepEqual([e.email, e.level, e.change], ['a@b.com', 'Top 1%', 'active']);
  assert.equal(parseBmcEvent({ type: 'membership.cancelled', data: {} }).change, 'inactive');
  assert.equal(parseBmcEvent({ type: 'donation.created', data: {} }).change, null);
});

test('Atom feed entries become Reddit-shaped posts', () => {
  const xml = '<feed><entry><author><name>/u/someone</name></author><content type="html">&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt; submitted by /u/someone</content><id>t3_abc</id><link href="https://www.reddit.com/r/closetrepublic/comments/abc/x/" /><published>2026-10-15T00:00:00+00:00</published><title>Hello</title></entry></feed>';
  const [p] = parseAtom(xml);
  assert.equal(p.name, 't3_abc');
  assert.equal(p.author, 'someone');
  assert.equal(p.permalink, '/r/closetrepublic/comments/abc/x/');
  assert.equal(p.selftext, 'Hi & bye');
});

test('ingest rules skip new, old, NSFW, flaired, removed and own posts', () => {
  const t = 1_000_000;
  const base = { name: 't3_new1', author: 'x', created_utc: t - 3600, selftext: 'hi', permalink: '/r/x/1' };
  assert.equal(shouldIngest(base, t), null);
  assert.equal(shouldIngest({ ...base, created_utc: t - 60 }, t), 'too new');
  assert.equal(shouldIngest({ ...base, created_utc: t - 49 * 3600 }, t), 'too old');
  assert.equal(shouldIngest({ ...base, over_18: true }, t), 'nsfw');
  assert.equal(shouldIngest({ ...base, link_flair_text: 'Meta' }, t), 'skipped flair');
  assert.equal(shouldIngest({ ...base, removed_by_category: 'moderator' }, t), 'removed');
  assert.equal(shouldIngest({ ...base, author: 'CloseTrepublic_Bot' }, t), 'our own crosspost');
  assert.equal(removalReason({ author: '[deleted]' }), 'deleted');
});

test('ingested posts hide the Reddit username by default and link back', () => {
  const body = renderRedditPost({ selftext: 'x'.repeat(700), author: 'someone', permalink: '/r/closetrepublic/comments/1/x/' });
  assert.ok(!body.includes('someone'));
  assert.ok(body.includes('https://www.reddit.com/r/closetrepublic/comments/1/x/'));
  assert.ok(body.includes('…'));
});

test('rate limiter never exceeds its per-minute budget', async () => {
  let clock = 0;
  const waits = [];
  const rl = new RateLimiter({ perMinute: 3, now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
  for (let i = 0; i < 4; i++) await rl.take();
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 60_000);
});

test('signatures are HMAC-SHA256 hex of the raw body', () => {
  assert.equal(validSignature('s', 'body', '9a6d1e70b9b37b1e5a0a2f7b62b86b8fe6a7cb5cb1b3a1a9c8b46d6d1c0b7a3b'), false);
  const good = crypto.createHmac('sha256', 's').update('body').digest('hex');
  assert.equal(validSignature('s', 'body', good), true);
  assert.equal(validSignature('', 'body', good), false);
});
