// cr-bridge entry point. One process (pm2: instances 1), all jobs run one at a time.
//   node src/index.js          run forever
//   node src/index.js --once   ensure groups, ingest, reconcile once, then exit (testing)
import { config, checkConfig } from './config.js';
import { kv, audit } from './db.js';
import { startServer } from './server.js';
import { startDiscord } from './discord.js';
import { ensureGroups, applyTier, applyAll, link } from './roles.js';
import { handleBmcEvent, expireMemberships } from './bmc.js';
import { ingest, reconcile, publishTopic, onForumDelete, onForumRestore, onUserDeleted } from './sync.js';
import { db } from './db.js';

const problems = checkConfig();
if (problems.length) {
  console.error(`[bridge] configuration problems:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

// Serial queue: Reddit calls, NodeBB writes and SQLite updates never interleave.
let chain = Promise.resolve();
const run = (name, task) => {
  const next = chain.then(task).catch((err) => {
    console.error(`[bridge] ${name} failed:`, err.message);
    return { error: err.message };
  });
  chain = next.then(() => {});
  return next;
};

const jobs = {
  ingest: () => run('ingest', async () => {
    const r = await ingest();
    kv.set('last-ingest', new Date().toISOString());
    return r;
  }),
  reconcile: () => run('reconcile', async () => {
    const r = await reconcile();
    await expireMemberships();
    kv.set('last-reconcile', new Date().toISOString());
    return r;
  }),
  roles: () => run('roles', async () => {
    await applyAll('scheduled reconcile');
    return { ok: true };
  }),
};

function onForumEvent(e) {
  const id = e.tid ?? e.pid ?? e.uid;
  run(`event ${e.event} ${id}`, async () => {
    switch (e.event) {
      case 'login':
        link.set(Number(e.uid), String(e.discordId));
        return applyTier(Number(e.uid), 'login');
      case 'user.delete':
        db.prepare('DELETE FROM user_links WHERE uid = ?').run(e.uid);
        db.prepare('DELETE FROM tiers WHERE uid = ?').run(e.uid);
        return onUserDeleted(Number(e.uid));
      case 'topic.post':
        return publishTopic(e.tid);
      case 'topic.edit':
        // Adding the consent tag after posting counts too.
        return publishTopic(e.tid);
      case 'topic.delete':
      case 'topic.purge':
        return onForumDelete({ tid: e.tid, kind: 'topic' });
      case 'topic.restore':
        return onForumRestore({ tid: e.tid, kind: 'topic' });
      case 'post.delete':
        return onForumDelete({ pid: e.pid, kind: 'post' });
      case 'post.restore':
        return onForumRestore({ pid: e.pid, kind: 'post' });
      default:
        return null; // post.save / post.edit: replies are not sent to Reddit
    }
  });
}

async function waitForForum() {
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureGroups();
      return;
    } catch (err) {
      console.error(`[bridge] forum not ready (${err.message}); retrying`);
      await new Promise((r) => setTimeout(r, Math.min(attempt * 2000, 30_000)));
    }
  }
}

if (process.argv.includes('--once')) {
  await waitForForum();
  console.log('ingest', await jobs.ingest());
  console.log('reconcile', await jobs.reconcile());
  process.exit(0);
}

audit('bridge.start', { dryRun: config.dryRun, reddit: config.reddit.mode });
startServer({ onForumEvent, onBmcEvent: (e) => run('bmc', () => handleBmcEvent(e)), jobs });
await waitForForum();
await startDiscord(async (discordId) => {
  const uid = link.byDiscord(discordId);
  if (uid) await run('discord role change', () => applyTier(uid, 'discord role change'));
});

const every = (seconds, job) => setInterval(job, seconds * 1000);
every(config.sync.pollSeconds ?? 120, jobs.ingest);
every((config.sync.reconcile?.everyMinutes ?? 15) * 60, jobs.reconcile);
every((config.roles.reconcileHours ?? 6) * 3600, jobs.roles);
jobs.ingest();
