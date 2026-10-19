// A tiny stand-in for Reddit, for testing the bridge without API access or a real subreddit.
//   node test/mock-reddit.mjs            (listens on 127.0.0.1:40017)
// Point the bridge at it:
//   REDDIT_MODE=api REDDIT_API_BASE=http://127.0.0.1:40017 REDDIT_AUTH_BASE=http://127.0.0.1:40017
//   REDDIT_RSS_BASE=http://127.0.0.1:40017 REDDIT_CLIENT_ID=x REDDIT_CLIENT_SECRET=x
//   REDDIT_USERNAME=closetrepublic_bot REDDIT_PASSWORD=x
// Or as the closetrepublic-sync Devvit app (reddit-app/), same data:
//   REDDIT_MODE=devvit DEVVIT_URL=http://127.0.0.1:40017/external DEVVIT_TOKEN=devvit_at_test
// Control it with:
//   curl -XPOST localhost:40017/_mock/post -d '{"title":"Hello","selftext":"Body","author":"someone","ageMinutes":30}'
//   curl -XPOST localhost:40017/_mock/remove/t3_abc1     (simulate a moderator removal)
//   curl -XPOST localhost:40017/_mock/approve/t3_abc1
//   curl -XPOST localhost:40017/_mock/edit/t3_abc1 -d '{"selftext":"new text"}'
//   curl localhost:40017/_mock/state
import http from 'node:http';

const port = Number(process.env.MOCK_REDDIT_PORT || 40017);
const things = new Map(); // fullname -> data
let seq = 1000;
const nowS = () => Math.floor(Date.now() / 1000);
const id36 = () => (seq++).toString(36);

function addPost({ title, selftext = '', author = 'someone', flair = null, ageMinutes = 30, url = null, over_18 = false }) {
  const id = id36();
  const post = {
    name: `t3_${id}`, id, title, selftext, author, link_flair_text: flair, over_18, score: 1,
    created_utc: nowS() - ageMinutes * 60, permalink: `/r/closetrepublic/comments/${id}/x/`,
    is_self: !url, url: url || `https://www.reddit.com/r/closetrepublic/comments/${id}/x/`, removed_by_category: null,
  };
  things.set(post.name, post);
  return post;
}

function addComment({ postId, body, author = 'someone', parent = null }) {
  const id = id36();
  const c = { name: `t1_${id}`, id, body, author, link_id: postId, parent_id: parent || postId, created_utc: nowS(), permalink: `/r/closetrepublic/comments/${postId.slice(3)}/x/${id}/`, removed_by_category: null };
  things.set(c.name, c);
  return c;
}

const APP = 'closetrepublic-sync';
const DEVVIT_TOKEN = process.env.MOCK_DEVVIT_TOKEN || 'devvit_at_test';
const listing = (children) => ({ kind: 'Listing', data: { children } });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'x-ratelimit-remaining': '99', 'x-ratelimit-reset': '60' }); res.end(JSON.stringify(body)); };
  const form = new URLSearchParams(raw);
  const p = url.pathname;

  // ---- Devvit app endpoints (reddit-app/src/server/index.ts), same JSON shapes
  if (p.startsWith('/external/')) {
    if (req.headers.authorization !== `bearer ${DEVVIT_TOKEN}`) return json(401, { error: 'unauthorized' });
    const b = raw ? JSON.parse(raw) : {};
    const own = (t) => t.author === APP;
    if (p === '/external/new-posts') {
      const posts = [...things.values()].filter((t) => t.name.startsWith('t3_') && !own(t)).sort((a, z) => z.created_utc - a.created_utc);
      return json(200, { posts: posts.slice(0, b.limit || 50) });
    }
    if (p === '/external/info') return json(200, { things: (b.ids || []).filter((i) => things.has(i)).map((i) => things.get(i)) });
    if (p === '/external/comments') {
      return json(200, { comments: [...things.values()].filter((t) => t.link_id === b.postId && !own(t)).sort((a, z) => a.created_utc - z.created_utc) });
    }
    if (p === '/external/submit-link') {
      const post = addPost({ title: b.title, author: APP, url: b.url, ageMinutes: 0 });
      return json(200, { name: post.name, permalink: post.permalink });
    }
    if (p === '/external/remove') {
      const t = things.get(b.id);
      if (!t || !own(t)) return json(403, { error: 'not a post made by this app' });
      t.removed_by_category = 'deleted'; t.author = '[deleted]';
      return json(200, { removed: b.id });
    }
    return json(404, { error: 'no such endpoint' });
  }

  if (p === '/api/v1/access_token') return json(200, { access_token: 'mock-token', expires_in: 3600 });
  if (p.match(/^\/r\/\w+\/new\/?$/)) {
    const posts = [...things.values()].filter((t) => t.name.startsWith('t3_') && !t.removed_by_category).sort((a, b) => b.created_utc - a.created_utc);
    return json(200, listing(posts.map((d) => ({ kind: 't3', data: d }))));
  }
  if (p.match(/^\/r\/\w+\/new\/\.rss$/)) {
    const posts = [...things.values()].filter((t) => t.name.startsWith('t3_') && !t.removed_by_category);
    res.writeHead(200, { 'content-type': 'application/atom+xml' });
    return res.end(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${posts.map((t) => `<entry><author><name>/u/${t.author}</name></author><content type="html">&lt;p&gt;${t.selftext}&lt;/p&gt; submitted by /u/${t.author}</content><id>${t.name}</id><link href="https://www.reddit.com${t.permalink}" /><published>${new Date(t.created_utc * 1000).toISOString()}</published><title>${t.title}</title></entry>`).join('')}</feed>`);
  }
  if (p === '/api/info') {
    const ids = (url.searchParams.get('id') || '').split(',');
    return json(200, listing(ids.filter((i) => things.has(i)).map((i) => ({ kind: i.slice(0, 2), data: things.get(i) }))));
  }
  const cm = p.match(/^\/r\/\w+\/comments\/(\w+)$/);
  if (cm) {
    const post = things.get(`t3_${cm[1]}`);
    const comments = [...things.values()].filter((t) => t.link_id === `t3_${cm[1]}`);
    return json(200, [listing([{ kind: 't3', data: post }]), listing(comments.map((c) => ({ kind: 't1', data: { ...c, replies: '' } })))]);
  }
  if (p === '/api/submit') {
    const post = addPost({ title: form.get('title'), author: 'closetrepublic_bot', url: form.get('url'), ageMinutes: 0 });
    return json(200, { json: { errors: [], data: { name: post.name, url: post.url } } });
  }
  if (p === '/api/del') {
    const t = things.get(form.get('id'));
    if (t) { t.removed_by_category = 'deleted'; t.author = '[deleted]'; }
    return json(200, {});
  }

  // ---- control endpoints
  const body = raw ? JSON.parse(raw) : {};
  if (p === '/_mock/post') return json(200, addPost(body));
  if (p === '/_mock/comment') return json(200, addComment(body));
  const ctl = p.match(/^\/_mock\/(remove|approve|edit)\/(t[13]_\w+)$/);
  if (ctl && things.has(ctl[2])) {
    const t = things.get(ctl[2]);
    if (ctl[1] === 'remove') t.removed_by_category = 'moderator';
    if (ctl[1] === 'approve') t.removed_by_category = null;
    if (ctl[1] === 'edit') Object.assign(t, body);
    return json(200, t);
  }
  if (p === '/_mock/state') return json(200, [...things.values()]);
  return json(404, { error: 'not mocked', path: p });
});

server.listen(port, '127.0.0.1', () => console.log(`mock Reddit on http://127.0.0.1:${port}`));
