# Guide: customizing and testing the Reddit sync

How to connect the bridge to r/closetrepublic, change what it copies and how, and prove each change on a test subreddit before it touches the real one. The design is in [how-it-works.md, section 2](how-it-works.md#2-reddit-bridge).

All settings live in two places on the server:

| File | Holds |
|---|---|
| `/etc/closet-republic/bridge.env` | Reddit mode, credentials, subreddit, rate cap |
| `/opt/closet-republic/cr-bridge/config/sync.json` | what gets copied where, and how it looks |

After changing either: `sudo -u nodebb -H pm2 restart cr-bridge`.

---

## 1. Set up the Reddit side

1. **Bot account.** Create a separate Reddit account for the bridge (for example u/closetrepublic_bot). Verify its email. Don't switch on two-factor login for it: the bridge logs in with a password ("script" app), which 2FA blocks.
2. **Make it trusted in the subreddit.** In r/closetrepublic mod tools: add it as an approved user, and as a moderator with only the "Posts" permission. Otherwise Reddit's spam filter quietly removes a new account's link posts.
3. **Create the app.** Signed in as the bot, open https://www.reddit.com/prefs/apps, "create another app", type **script**, redirect URI `http://localhost:8080` (unused). The id is under the app name; the secret is labelled "secret".
4. **API access.** Reddit reviews new API apps before their credentials work. Apply through Reddit's developer support form, describing the bridge (a non-commercial bot that copies posts between a subreddit and the community's own forum, under 100 requests a minute). Until it is approved, use RSS mode.
5. **User agent.** Reddit requires a descriptive one: `server:closetrepublic-bridge:0.1.0 (by /u/<main account>)`.

In `/etc/closet-republic/bridge.env`:

```
REDDIT_MODE=api            # api | rss | off
REDDIT_SUBREDDIT=closetrepublic
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USERNAME=closetrepublic_bot
REDDIT_PASSWORD=...
REDDIT_USER_AGENT=server:closetrepublic-bridge:0.1.0 (by /u/your_main_account)
REDDIT_MAX_QPM=60
```

**Modes**

| Mode | Needs | Does |
|---|---|---|
| `api` | approved app + bot account | everything: ingest, publish, removals, edits, comments |
| `rss` | nothing | ingest new posts from the public feed only. No flair routing, no removal checks, no publishing |
| `off` | | nothing (the forum carries on as normal) |

## 2. Settings in `sync.json`

```json
{
  "pollSeconds": 120,
  "ingest": {
    "enabled": true,
    "defaultCid": 5,
    "flairToCid": { "Art": 7, "News": 8 },
    "skipFlairs": ["Meta", "Mod Announcement"],
    "minAgeMinutes": 10,
    "maxAgeHours": 48,
    "allowNsfw": false,
    "excerptChars": 600,
    "author": "hidden",
    "mirrorComments": false,
    "commentWindowHours": 72,
    "tags": ["from-reddit"]
  },
  "publish": {
    "enabled": true,
    "consentTag": "share-to-reddit",
    "cids": [3],
    "minTier": null,
    "titlePrefix": "",
    "flairId": null
  },
  "reconcile": { "everyMinutes": 15, "windowDays": 14 }
}
```

| Key | Default | What it does |
|---|---|---|
| `pollSeconds` | 120 | How often new Reddit posts are fetched (one API call each time) |
| `ingest.enabled` | true | Copy Reddit posts into the forum |
| `ingest.defaultCid` | 0 | Forum category for copied posts. **Must be set**: the bridge refuses to start without it unless `REDDIT_MODE=off` |
| `ingest.flairToCid` | {} | Send posts with a given flair to another category (exact flair text) |
| `ingest.skipFlairs` | Meta, Mod Announcement | Never copy posts with these flairs |
| `ingest.minAgeMinutes` | 10 | Wait this long before copying, so AutoModerator and moderators act first |
| `ingest.maxAgeHours` | 48 | Ignore older posts (also how far back the bridge catches up after an outage) |
| `ingest.allowNsfw` | false | Copy posts marked NSFW |
| `ingest.excerptChars` | 600 | Length of the excerpt; the full post stays on Reddit |
| `ingest.author` | `hidden` | `hidden`: "Shared from r/closetrepublic". `shown`: "Posted by u/name" |
| `ingest.mirrorComments` | false | Also copy Reddit comments as forum replies (one extra API call per recent topic per poll) |
| `ingest.commentWindowHours` | 72 | How long after a post its comments keep being copied |
| `ingest.tags` | from-reddit | Tags on every copied topic |
| `publish.enabled` | true | Share consenting forum topics to Reddit |
| `publish.consentTag` | share-to-reddit | The tag an author adds to say "share this" |
| `publish.cids` | [] | Categories allowed to share. **Empty means nothing is shared.** List public categories only |
| `publish.minTier` | null | Only members of this tier and above can share, e.g. `"citizen"`. null = any member |
| `publish.titlePrefix` | "" | e.g. `"[Forum] "` |
| `publish.flairId` | null | Flair template id for the bot's posts (see below) |
| `reconcile.everyMinutes` | 15 | How often removals, approvals and edits are checked |
| `reconcile.windowDays` | 14 | How far back they are checked |

**Flair ids for `publish.flairId`**: in the subreddit's mod tools, Post flair, each flair has an id (a UUID) in its settings. Create one such as "From the forum" and paste its id.

**Changing how copies look**: the text of a copied post is built by `renderRedditPost` in `cr-bridge/src/sync.js`, and comments by `renderRedditComment`. Both return Markdown. After editing one, run `npm test` in the bridge folder; the "ingested posts hide the Reddit username" test protects the privacy default.

## 3. Test a change before it reaches r/closetrepublic

Use three stages, in order.

### Stage 1: the mock Reddit

Run through the table in [testing.md, step 3](testing.md#3-reddit-sync-with-the-fake-reddit). Add a scenario for each change. For example, after adding `"flairToCid": {"Art": 7}`:

```bash
curl -XPOST 127.0.0.1:40017/_mock/post -d '{"title":"My drawing","selftext":"...","flair":"Art","ageMinutes":30}'
curl -s -XPOST -H "Authorization: Bearer $TOKEN" 127.0.0.1:40007/admin/run/ingest
# expect {"seen":...,"created":1} and the topic in category 7
```

### Stage 2: a private test subreddit, in dry-run

1. Create r/closetrepublic_test (or any name), set it to private, add the bot as approved user and moderator.
2. In `bridge.env`: `REDDIT_SUBREDDIT=closetrepublic_test`, real credentials, `CR_DRY_RUN=true`. Restart the bridge.
3. Post a few things there by hand: text, link, a flaired one, an NSFW one.
4. Run ingest and reconcile, then read what the bridge *would* have done:

```bash
sudo sqlite3 /opt/closet-republic/cr-bridge/data/bridge.db \
  "SELECT datetime(at,'unixepoch'), action, detail FROM audit WHERE action LIKE 'dry-run%' ORDER BY id DESC LIMIT 30;"
```

Dry run reads from Reddit and the forum for real but writes nothing to either.

### Stage 3: the test subreddit, live

Set `CR_DRY_RUN=false`, restart, and repeat. Then:

- remove one of the test posts as a moderator, run reconcile, check the forum copy is hidden
- approve it again, run reconcile, check it is back
- post a forum topic tagged `share-to-reddit` in an allowed category, check the bot's link post appears in the test subreddit
- delete that forum topic, check the link post is gone

Only then switch `REDDIT_SUBREDDIT` to `closetrepublic`.

Before switching, clear the test mappings so the real subreddit starts clean:

```bash
sudo -u nodebb -H pm2 stop cr-bridge
sudo sqlite3 /opt/closet-republic/cr-bridge/data/bridge.db "DELETE FROM sync_map;"
sudo -u nodebb -H pm2 start cr-bridge
```

## 4. Rate-limit budget

Reddit allows 100 requests a minute per app; the bridge caps itself at `REDDIT_MAX_QPM` (60) and slows down further when Reddit's rate headers say so.

| Activity | Calls |
|---|---|
| Ingest | 1 per `pollSeconds` (30 an hour at 120 s) |
| Reconcile | 1 per 100 tracked items per run (about 4 an hour) |
| Publish | 1 per shared topic, 1 per deletion |
| Comment mirroring | 1 per recent copied topic per poll |

With comments off, the bridge uses about one call a minute. With comments on and 50 topics in the window at a 120 s poll, it's about 25 a minute: still inside the cap, but raise `pollSeconds` or lower `commentWindowHours` if the subreddit gets busy.

## 5. When something looks wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `Reddit login failed (401)` in the log | wrong password, 2FA on the bot, or app not approved yet | check credentials; turn off 2FA for the bot; use `rss` until approved |
| `403` on every call | app not approved, or the subreddit is private and the bot isn't a member | approve the bot in the subreddit |
| Nothing ingested | posts younger than `minAgeMinutes` or older than `maxAgeHours`, or already copied | check `curl 127.0.0.1:40007/healthz` and the audit table |
| Topic not shared to Reddit | no consent tag, category not in `publish.cids`, author below `minTier`, or still in the post queue | the audit table has a `publish.skipped` line with the reason |
| Bot's posts vanish on Reddit | spam filter | approve the bot account in the subreddit (step 1.2) |
| `429` in the log | another tool shares the app's budget | the bridge backs off on its own; lower `REDDIT_MAX_QPM` |
| Duplicates after deleting `bridge.db` | the bridge forgot what it had copied | restore `bridge.db` from the nightly backup instead of deleting it |
