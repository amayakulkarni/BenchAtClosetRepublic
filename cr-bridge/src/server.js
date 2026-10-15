// HTTP endpoints. Bind to 127.0.0.1; nginx exposes only /bridge/webhooks/* publicly.
//   POST /internal/nodebb-event  from the forum plugin      (x-cr-signature, CR_BRIDGE_SECRET)
//   POST /webhooks/bmc           Buy Me a Coffee, direct    (x-signature-sha256, BMC_WEBHOOK_SECRET)
//                                or forwarded by the site   (x-cr-signature, CR_BRIDGE_SECRET)
//   POST /admin/run/<job>        ingest | reconcile | roles  (Authorization: Bearer CR_ADMIN_TOKEN)
//   GET  /healthz
import crypto from 'node:crypto';
import http from 'node:http';
import { config } from './config.js';
import { kv } from './db.js';
import { discordEnabled, discordReady } from './discord.js';

const sign = (secret, raw) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
export function validSignature(secret, raw, given) {
  if (!secret || !given) return false;
  const a = Buffer.from(sign(secret, raw));
  const b = Buffer.from(String(given).trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sameSecret = (a, b) => Boolean(a) && crypto.timingSafeEqual(digest(a), digest(b));

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function startServer({ onForumEvent, onBmcEvent, jobs }) {
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://x').pathname.replace(/^\/bridge/, '');
      if (req.method === 'GET' && path === '/healthz') {
        return send(res, 200, {
          ok: true,
          dryRun: config.dryRun,
          reddit: config.reddit.mode,
          discord: discordEnabled() ? (discordReady() ? 'connected' : 'connecting') : 'off',
          lastIngest: kv.get('last-ingest'),
          lastReconcile: kv.get('last-reconcile'),
        });
      }
      if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
      const raw = await readBody(req);

      if (path === '/internal/nodebb-event') {
        if (!validSignature(config.secret, raw, req.headers['x-cr-signature'])) return send(res, 401, { error: 'bad signature' });
        onForumEvent(JSON.parse(raw)); // queued; the forum does not wait
        return send(res, 202, { queued: true });
      }

      if (path === '/webhooks/bmc') {
        const direct = validSignature(config.bmc.webhookSecret, raw, req.headers['x-signature-sha256']);
        const forwarded = validSignature(config.secret, raw, req.headers['x-cr-signature']);
        if (!direct && !forwarded) return send(res, 401, { error: 'bad signature' });
        return send(res, 200, await onBmcEvent(JSON.parse(raw)));
      }

      const job = path.match(/^\/admin\/run\/(\w+)$/)?.[1];
      if (job) {
        const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!sameSecret(config.adminToken, auth)) return send(res, 401, { error: 'unauthorized' });
        if (!jobs[job]) return send(res, 404, { error: `no job ${job}` });
        return send(res, 200, await jobs[job]());
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[bridge] request failed:', err.message);
      return send(res, 500, { error: err.message });
    }
  });

  server.listen(config.port, config.host, () => console.log(`[bridge] listening on http://${config.host}:${config.port}`));
  return server;
}
