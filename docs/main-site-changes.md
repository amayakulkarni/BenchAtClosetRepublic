# Main site changes for the forum

Two small changes to closetrepublic.com (the Next.js site). Nothing in the site has been changed yet; the site thread ("Review backend and brand assets") can apply these.

## 1. Forward Buy Me a Coffee events to the forum bridge

The site already verifies Buy Me a Coffee webhooks at `/api/webhooks/buymeacoffee` and records payments in the treasury. Forwarding each verified event to the bridge means Buy Me a Coffee keeps one webhook, one secret and one place to look when something goes wrong.

New file `src/lib/forum-bridge.ts`:

```ts
import crypto from 'node:crypto';

// Sends a verified Buy Me a Coffee event on to the forum bridge (cr-bridge), signed with the
// shared secret, so membership changes update forum ranks. Never blocks or fails the webhook.
//   FORUM_BRIDGE_URL     http://127.0.0.1:40007 when the forum is on the same server,
//                        https://forum.closetrepublic.com/bridge otherwise
//   FORUM_BRIDGE_SECRET  the same value as CR_BRIDGE_SECRET in /etc/closet-republic/bridge.env
export function forwardToForumBridge(raw: string) {
  const base = process.env.FORUM_BRIDGE_URL;
  const secret = process.env.FORUM_BRIDGE_SECRET;
  if (!base || !secret) return;
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  fetch(`${base.replace(/\/$/, '')}/webhooks/bmc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cr-signature': signature },
    body: raw,
    signal: AbortSignal.timeout(5000),
  }).catch((err) => console.warn('[forum-bridge] not forwarded:', err.message));
}
```

In `src/app/api/webhooks/buymeacoffee/route.ts`, right after the signature check passes and before the event is parsed (so membership events the treasury ignores are still forwarded):

```ts
import { forwardToForumBridge } from '@/lib/forum-bridge';
// ...
  if (!given || !safeEqual(given, expected)) return NextResponse.json({ error: 'Bad signature' }, { status: 401 });

  forwardToForumBridge(raw);
```

The bridge ignores Buy Me a Coffee test events (`live_mode: false`) unless `BMC_ACCEPT_TEST_EVENTS=true` in its own env, and ignores retries by event id, so forwarding everything is safe.

## 2. Point the community links at the forum and subreddit

In the site's production environment:

```
COMMUNITY_FORUM_URL=https://forum.closetrepublic.com
COMMUNITY_FORUM_NAME=The Republic's forum
COMMUNITY_REDDIT_URL=https://www.reddit.com/r/closetrepublic
FORUM_BRIDGE_URL=http://127.0.0.1:40007
FORUM_BRIDGE_SECRET=<CR_BRIDGE_SECRET from /etc/closet-republic/bridge.env>
```

Then restart the site the usual way (`pm2 restart closet-republic --update-env`). The /development pages stop saying "coming soon" for Reddit and the forum.
