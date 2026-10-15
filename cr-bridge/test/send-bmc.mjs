// Sends a signed, made-up Buy Me a Coffee event to the bridge, the same way the main site
// forwards real ones. For testing rank changes.
//   node --env-file=/etc/closet-republic/bridge.env test/send-bmc.mjs membership.started you@example.com "Middle class"
//   node --env-file=/etc/closet-republic/bridge.env test/send-bmc.mjs membership.cancelled you@example.com
import crypto from 'node:crypto';

const [type = 'membership.started', email = 'you@example.com', level] = process.argv.slice(2);
const port = process.env.CR_BRIDGE_PORT || 40007;
const secret = process.env.CR_BRIDGE_SECRET;
if (!secret) throw new Error('CR_BRIDGE_SECRET is not set (pass --env-file)');

const body = JSON.stringify({
  type,
  live_mode: true,
  event_id: `test-${Date.now()}`,
  data: { id: Date.now(), supporter_email: email, ...(level ? { membership_level_name: level } : {}) },
});
const res = await fetch(`http://127.0.0.1:${port}/webhooks/bmc`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-cr-signature': crypto.createHmac('sha256', secret).update(body).digest('hex') },
  body,
});
console.log(res.status, await res.text());
