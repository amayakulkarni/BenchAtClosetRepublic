// Reddit access. Two modes:
//  api: OAuth "script" app logged in as the bot account (u/closetrepublic or similar).
//       Can read, crosspost forum topics, delete its own posts and check removals.
//  rss: no credentials at all. Read-only, new posts only, no removal checks beyond
//       "the post vanished from the feed". Useful until Reddit approves API access.
import { config } from './config.js';
import { RateLimiter } from './ratelimit.js';

const limiter = new RateLimiter({ perMinute: config.reddit.maxPerMinute });
let token = null;
let tokenExpires = 0;

async function accessToken() {
  if (token && Date.now() < tokenExpires - 60_000) return token;
  const { clientId, clientSecret, username, password, userAgent, authBase } = config.reddit;
  await limiter.take();
  const res = await fetch(`${authBase}/api/v1/access_token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': userAgent,
    },
    body: new URLSearchParams({ grant_type: 'password', username, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`Reddit login failed (${res.status}): ${json.error || 'no token'}`);
  token = json.access_token;
  tokenExpires = Date.now() + (json.expires_in || 3600) * 1000;
  return token;
}

async function call(method, path, params = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await limiter.take();
    const url = new URL(`${config.reddit.apiBase}${path}`);
    const init = {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, 'user-agent': config.reddit.userAgent },
    };
    if (method === 'GET') {
      for (const [k, v] of Object.entries({ raw_json: 1, ...params })) url.searchParams.set(k, String(v));
    } else {
      init.headers['content-type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams({ api_type: 'json', ...params });
    }
    const res = await fetch(url, init);
    limiter.observe(res.headers);
    if (res.status === 401) {
      token = null; // expired early; log in again
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      limiter.backoff(attempt, Number(res.headers.get('retry-after')));
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Reddit ${method} ${path} returned ${res.status}`);
    const errors = json?.json?.errors;
    if (errors?.length) throw new Error(`Reddit ${path}: ${errors.map((e) => e.join(' ')).join('; ')}`);
    return json;
  }
  throw new Error(`Reddit ${method} ${path}: gave up after retries`);
}

const sub = () => config.reddit.subreddit;

export const reddit = {
  // Newest submissions, newest first, as Reddit "link" objects (t3).
  async newPosts(limit = 50) {
    if (config.reddit.mode === 'rss') return rssNewPosts();
    const json = await call('GET', `/r/${sub()}/new`, { limit });
    return json.data.children.map((c) => c.data);
  },

  // Current state of up to 100 things (posts or comments) by fullname.
  async info(fullnames) {
    if (config.reddit.mode !== 'api' || !fullnames.length) return [];
    const out = [];
    for (let i = 0; i < fullnames.length; i += 100) {
      const json = await call('GET', '/api/info', { id: fullnames.slice(i, i + 100).join(',') });
      out.push(...json.data.children.map((c) => c.data));
    }
    return out;
  },

  // Flat list of a post's comments (t1), oldest first.
  async comments(postId36) {
    if (config.reddit.mode !== 'api') return [];
    const json = await call('GET', `/r/${sub()}/comments/${postId36}`, { limit: 200, sort: 'old' });
    const flat = [];
    const walk = (listing) => {
      for (const child of listing?.data?.children || []) {
        if (child.kind !== 't1') continue;
        flat.push(child.data);
        if (child.data.replies) walk(child.data.replies);
      }
    };
    walk(json[1]);
    return flat.sort((a, b) => a.created_utc - b.created_utc);
  },

  async submitLink({ title, url, flairId }) {
    const params = { sr: sub(), kind: 'link', title: title.slice(0, 300), url, resubmit: 'true', sendreplies: 'false' };
    if (flairId) params.flair_id = flairId;
    const json = await call('POST', '/api/submit', params);
    return json.json.data.name; // t3_xxx
  },

  async remove(fullname) {
    await call('POST', '/api/del', { id: fullname });
  },
};

// A Reddit item is gone when its author deleted it or a moderator/admin removed it.
export function removalReason(thing) {
  if (!thing) return 'missing';
  if (thing.removed_by_category) return thing.removed_by_category; // moderator, deleted, author, reddit, automod_filtered…
  if (thing.author === '[deleted]') return 'deleted';
  if (thing.selftext === '[removed]' || thing.body === '[removed]') return 'removed';
  if (thing.selftext === '[deleted]' || thing.body === '[deleted]') return 'deleted';
  return null;
}

// ---------------------------------------------------------------- RSS (Atom) fallback

async function rssNewPosts() {
  await limiter.take();
  const res = await fetch(`${config.reddit.rssBase}/r/${sub()}/new/.rss?limit=50`, {
    headers: { 'user-agent': config.reddit.userAgent },
  });
  limiter.observe(res.headers);
  if (res.status === 429) {
    limiter.backoff(1, Number(res.headers.get('retry-after')));
    return [];
  }
  if (!res.ok) throw new Error(`Reddit RSS returned ${res.status}`);
  return parseAtom(await res.text());
}

const decode = (s = '') =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '';

export function parseAtom(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => {
    const name = decode(tag(entry, 'id')).trim();
    const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1] || '';
    const html = decode(tag(entry, 'content'));
    const text = decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return {
      name,
      id: name.replace(/^t3_/, ''),
      title: decode(tag(entry, 'title')).trim(),
      permalink: link.replace(/^https?:\/\/[^/]+/, ''),
      author: decode(tag(tag(entry, 'author'), 'name')).replace(/^\/u\//, ''),
      created_utc: Math.floor(Date.parse(tag(entry, 'published') || tag(entry, 'updated')) / 1000),
      selftext: text.replace(/\s*submitted by\s*\/u\/.*$/, ''),
      link_flair_text: null, // the feed does not carry flair
      score: null,
      over_18: false,
      fromRss: true,
    };
  });
}
