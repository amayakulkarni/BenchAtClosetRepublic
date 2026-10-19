// closetrepublic-sync: a Devvit app installed in r/closetrepublic.
//
// The forum's bridge (cr-bridge) calls the endpoints below over HTTPS with an app token
// ("managed token", Developer Settings of this app). Devvit checks the token before any of
// this code runs. The app never calls out to the forum; it only answers the bridge.
//
//   POST /external/new-posts     newest posts in the subreddit
//   POST /external/info          current state of posts and comments, by id
//   POST /external/comments      a post's comments, oldest first
//   POST /external/submit-link   share a forum topic as a link post (as the app account)
//   POST /external/remove        delete one of the app's own link posts
//
// Posts and comments are returned in the same shape as Reddit's own API (snake_case fields),
// so the bridge treats this app and a Reddit API key the same way.
import { Hono } from 'hono';
import { context, createServer, externalEndpoints, getServerPort, reddit } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';

type Post = Awaited<ReturnType<typeof reddit.getPostById>>;
type Comment = Awaited<ReturnType<typeof reddit.getCommentById>>;

const app = new Hono();

const subredditName = async () => context.subredditName || (await reddit.getCurrentSubreddit()).name;
const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

// The app's own link posts are the forum's shares; the bridge must not copy them back.
const isOwn = (author: string) => author.toLowerCase() === String(context.appSlug || '').toLowerCase();

function removedCategory(thing: { removed: boolean; spam: boolean; removedByCategory?: string }) {
  if (thing.removedByCategory) return thing.removedByCategory;
  if (thing.spam) return 'spam';
  if (thing.removed) return 'moderator';
  return null;
}

function postJson(p: Post) {
  const isSelf = !p.url || p.url.includes(`/comments/${p.id.slice(3)}`);
  return {
    kind: 't3',
    name: p.id,
    id: p.id.slice(3),
    title: p.title,
    author: p.authorName,
    permalink: p.permalink,
    created_utc: seconds(p.createdAt),
    selftext: p.body ?? '',
    url: p.url,
    is_self: isSelf,
    link_flair_text: p.flair?.text ?? null,
    over_18: p.nsfw,
    score: p.score,
    removed_by_category: removedCategory(p),
  };
}

function commentJson(c: Comment) {
  return {
    kind: 't1',
    name: c.id,
    id: c.id.slice(3),
    parent_id: c.parentId,
    author: c.authorName,
    body: c.body,
    permalink: c.permalink,
    created_utc: seconds(c.createdAt),
    removed_by_category: removedCategory(c),
  };
}

const body = async <T>(c: { req: { json: () => Promise<unknown> } }): Promise<Partial<T>> =>
  ((await c.req.json().catch(() => ({}))) || {}) as Partial<T>;

const fail = (c: any, err: unknown, status = 500) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[closetrepublic-sync] ${c.req.path}: ${message}`);
  return c.json({ error: message }, status);
};

app.post('/external/new-posts', async (c) => {
  try {
    const { limit = 50 } = await body<{ limit: number }>(c);
    const posts = await reddit
      .getNewPosts({ subredditName: await subredditName(), limit: Math.min(Number(limit) || 50, 100), pageSize: 100 })
      .all();
    return c.json({ posts: posts.filter((p) => !isOwn(p.authorName)).map(postJson) });
  } catch (err) {
    return fail(c, err);
  }
});

app.post('/external/info', async (c) => {
  try {
    const { ids = [] } = await body<{ ids: string[] }>(c);
    if (!Array.isArray(ids) || ids.length > 100) return fail(c, new Error('ids: up to 100 ids'), 400);
    const things = [];
    for (const id of ids) {
      try {
        if (id.startsWith('t3_')) things.push(postJson(await reddit.getPostById(id as `t3_${string}`)));
        else if (id.startsWith('t1_')) things.push(commentJson(await reddit.getCommentById(id as `t1_${string}`)));
      } catch {
        // Gone entirely: the bridge treats a missing id as removed.
      }
    }
    return c.json({ things });
  } catch (err) {
    return fail(c, err);
  }
});

app.post('/external/comments', async (c) => {
  try {
    const { postId } = await body<{ postId: string }>(c);
    if (!postId || !/^t3_[a-z0-9]+$/.test(postId)) return fail(c, new Error('postId: a t3_ id'), 400);
    const flat: ReturnType<typeof commentJson>[] = [];
    const walk = async (list: Comment[], depth: number) => {
      for (const comment of list) {
        if (flat.length >= 200) return;
        if (!isOwn(comment.authorName)) flat.push(commentJson(comment));
        if (depth < 4) await walk(await comment.replies.all(), depth + 1);
      }
    };
    await walk(await reddit.getComments({ postId: postId as `t3_${string}`, limit: 200, sort: 'old' }).all(), 0);
    flat.sort((a, b) => a.created_utc - b.created_utc);
    return c.json({ comments: flat });
  } catch (err) {
    return fail(c, err);
  }
});

app.post('/external/submit-link', async (c) => {
  try {
    const { title, url, flairId } = await body<{ title: string; url: string; flairId: string }>(c);
    if (!title || !url || !/^https:\/\//.test(url)) return fail(c, new Error('title and an https url are required'), 400);
    const post = await reddit.submitPost({
      subredditName: await subredditName(),
      title: String(title).slice(0, 300),
      url: String(url),
      sendreplies: false,
      ...(flairId ? { flairId: String(flairId) } : {}),
    });
    return c.json({ name: post.id, permalink: post.permalink });
  } catch (err) {
    return fail(c, err);
  }
});

app.post('/external/remove', async (c) => {
  try {
    const { id } = await body<{ id: string }>(c);
    if (!id || !id.startsWith('t3_')) return fail(c, new Error('id: a t3_ id'), 400);
    const post = await reddit.getPostById(id as `t3_${string}`);
    // Only the app's own shares; anything else stays a moderator decision.
    if (!isOwn(post.authorName)) return fail(c, new Error('not a post made by this app'), 403);
    await post.delete();
    return c.json({ removed: id });
  } catch (err) {
    return fail(c, err);
  }
});

// Moderator menu: shows the address for DEVVIT_URL in the bridge settings, in a box that can
// be selected and copied.
app.post('/internal/menu/bridge-address', async (c) => {
  try {
    const url = await externalEndpoints.getExternalUrl({ appSlug: context.appSlug, locationId: context.subredditId });
    return c.json<UiResponse>({
      showForm: {
        name: 'bridgeAddress',
        form: {
          title: 'Forum bridge address',
          description: 'Copy this into DEVVIT_URL in /etc/closet-republic/bridge.env on the forum server.',
          acceptLabel: 'Done',
          fields: [{ name: 'url', label: 'DEVVIT_URL', type: 'string', defaultValue: url }],
        },
      },
    });
  } catch (err) {
    console.error(err);
    return c.json<UiResponse>({ showToast: 'Could not get the address. External endpoints may not be enabled for this app yet.' });
  }
});

app.post('/internal/form/bridge-address', (c) => c.json<UiResponse>({ showToast: 'Done' }));

const server = createServer(app);
server.on('error', (err: Error) => console.error(`server error; ${err.stack}`));
server.listen(getServerPort());
