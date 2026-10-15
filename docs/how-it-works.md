# Closet Republic forum: architecture

The Republic's own discussion space, its bridge to r/closetrepublic, and how Discord and Buy Me a Coffee ranks show up on it.

**Decisions in one place**

| Question | Decision |
|---|---|
| Forum software | NodeBB 4.16.3 (pinned), MongoDB 8.0 (Redis also supported) |
| Address | `https://forum.closetrepublic.com`, NodeBB on `127.0.0.1:40006` behind nginx |
| Glue service | `cr-bridge` on `127.0.0.1:40007` (Reddit sync, role tiers, Buy Me a Coffee) |
| Login | "Log in with Discord" through a small custom NodeBB plugin, with pseudonymous usernames |
| Ranks | Five paid tiers ranked by Buy Me a Coffee price; highest of Discord role and membership wins; one NodeBB group per member, none for non-members |
| Reddit | Reddit posts copied in as excerpts with a link back; forum topics go to Reddit only when the author adds the `share-to-reddit` tag |
| Removals | Follow the content both ways (removed on Reddit → hidden on the forum; deleted on the forum → deleted on Reddit) |
| Process manager | pm2 under a separate `nodebb` user, next to the main site's pm2 |

Ports 40001 to 40005 stay with the main site. Nothing here listens on them.

```
                    Internet
                       │  443 (TLS, Let's Encrypt)
                ┌──────▼───────┐
                │    nginx     │  forum.closetrepublic.com
                └──┬────────┬──┘
     everything    │        │  /bridge/webhooks/*  (only the webhooks are public)
                   ▼        ▼
   ┌────────────────────┐  signed events  ┌────────────────────────┐
   │ NodeBB 4.16.3      │ ──────────────▶ │ cr-bridge              │
   │ 127.0.0.1:40006    │ ◀────────────── │ 127.0.0.1:40007        │
   │ + closet-republic  │   Write API     │ SQLite: data/bridge.db │
   │   plugin           │  (master token) └──┬───────┬────────┬────┘
   └──────┬─────────────┘                    │       │        │
          │                    Reddit API ◀──┘       │        └──▶ Discord gateway
     MongoDB 127.0.0.1:27017   (or RSS)              │             (read roles only)
                                                     │
            closetrepublic.com (Next.js, :40001) ────┘ forwards Buy Me a Coffee
                                                       webhooks, signed
```

The reference code for every box is in this folder: [`nodebb/plugin/`](../nodebb/plugin/library.js), [`cr-bridge/`](../cr-bridge/src/index.js), and [`install-forum.sh`](../install-forum.sh). All three were run against a real NodeBB 4.16.3 with mock Reddit and mock Discord servers (see [testing.md](testing.md) for what was and was not tested).

---

## 1. A forum that survives being deplatformed

### 1.1 Components

| Part | What it is | Where |
|---|---|---|
| NodeBB 4.16.3 | The forum. Node 22, MongoDB 8.0 | `/opt/closet-republic/nodebb`, `127.0.0.1:40006` |
| `nodebb-plugin-closet-republic` | Discord login with pseudonyms; reports topic and post changes to the bridge | installed into NodeBB |
| `cr-bridge` | One Node process: Reddit sync, rank sync, Buy Me a Coffee events | `/opt/closet-republic/cr-bridge`, `127.0.0.1:40007` |
| nginx + certbot | TLS and the only public entry point | ports 80 and 443 |
| pm2 (user `nodebb`) | Keeps `nodebb` and `cr-bridge` running; starts on boot via `pm2-nodebb.service` | separate from the main site's pm2 |
| Backups | Nightly database dump, uploads, bridge database and config, kept 14 days | `/opt/closet-republic/backups` |

### 1.2 Threats and what answers each

"Resisting censorship and deplatforming" here means that no single company can take the Republic's conversations away. The forum is the home; Reddit and Discord are satellites that can disappear without the forum losing anything.

| If this happens | What keeps the Republic talking |
|---|---|
| Reddit bans or quarantines r/closetrepublic | Every Reddit post that mattered already has a forum copy with its own discussion. Set `REDDIT_MODE=off`; nothing else changes. |
| Discord bans the server or the bot | Existing members keep their forum accounts and ranks: the bridge never downgrades while Discord is unreachable, and Buy Me a Coffee memberships keep ranks on their own. Keep NodeBB's normal email-and-password login switched on so members can add a password as a second way in. New members can register by email. |
| The hosting company drops the server | Restore from the off-site backup on any Ubuntu server with the same setup script, then point DNS at it. Keep the DNS TTL for `forum.` at 300 seconds so the move takes minutes. |
| The domain is seized or the registrar suspends it | Registrar lock and two-factor login on the registrar account. Keep a second domain parked with the same nginx config ready. |
| A CDN or proxy in front (for example Cloudflare) drops the account | Don't depend on one: the nginx config here works without a CDN, so switching it off is a DNS change. |
| The forum itself has to go offline for a while | Public categories federate over ActivityPub (built into NodeBB 4), so copies of public discussions already live on Mastodon, Lemmy and other fediverse servers that follow them. |
| Data loss | Nightly backups, plus a copy off the server (see the production guide, step 6). The bridge's database holds only mappings, so losing it means at worst some duplicated Reddit copies, never lost posts. |

### 1.3 ActivityPub (fediverse) federation

NodeBB 4 ships with ActivityPub **switched on**. Because many members once had to hide who they are, federation is opt-in per category, not forum-wide:

- Public categories (announcements, Public Square): keep the `fediverse` pseudo-group's read privilege. Fediverse users can follow them, and replies from Mastodon or Lemmy arrive as forum replies.
- Every other category (rank halls, Safe Room, From r/closetrepublic): remove the `fediverse` privilege in ACP > Manage > Privileges. Anything that federates is copied to servers nobody here controls and cannot be fully deleted later.
- Ingest from the fediverse: a forum category can follow a Lemmy or other fediverse community one way (ACP > Manage > Categories > *category* > Federation > Synchronization). Reddit does not speak ActivityPub, so Reddit uses the bridge instead.

### 1.4 Maintaining it

- **Updates**: NodeBB is pinned to a tag. To upgrade, re-run the setup script with `--nodebb-version vX.Y.Z` on the test machine first, then production. The script fetches the tag, reinstalls, rebuilds and reloads.
- **Monitoring**: `curl -s 127.0.0.1:40007/healthz` reports Reddit mode, Discord connection, last ingest and last reconcile times. `sudo forum-pm2 logs` shows both processes.
- **Moderation**: NodeBB's post queue holds new members' first posts until a moderator approves them (on by default). Keep it on. Topics go to Reddit only after approval, because the plugin reports a topic when it is actually posted.

---

## 2. Reddit bridge

### 2.1 Pipelines

| Pipeline | Direction | How it runs | Transport and auth |
|---|---|---|---|
| Forum events | forum → bridge | NodeBB plugin hooks, immediately | `POST 127.0.0.1:40007/internal/nodebb-event`, HMAC-SHA256 in `x-cr-signature` |
| Ingest | Reddit → forum | polling every 120 s (Reddit has no webhooks) | Reddit OAuth API as the bot account, or the public RSS feed |
| Publish | forum → Reddit | on a forum event | Reddit `POST /api/submit` (link post) |
| Reconcile | both ways | every 15 minutes | Reddit `GET /api/info` (100 items per call) and the NodeBB Write API |
| Comments (optional, off by default) | Reddit → forum | with each ingest | Reddit `GET /r/<sub>/comments/<id>` |

Topics move both ways, but not symmetrically. Replies written on the forum never go to Reddit: posting someone's words on a second platform needs their consent each time, and Reddit's bot rules frown on mirrored comments. Reddit replies can be mirrored into the forum (`mirrorComments`), off by default.

The bridge runs one job at a time from a queue, so Reddit calls, forum writes and its SQLite file never interleave. A forum outage or bridge outage loses nothing: the next ingest picks up what it missed (posts up to 48 hours old), and the reconcile pass finds forum deletions that were never reported.

### 2.2 Data mappings

**Reddit post (t3) → forum topic**

| Reddit field | Forum | Notes |
|---|---|---|
| `name` (t3_abc) | `sync_map.reddit_id` → `tid`, `pid` | the join key for every later sync |
| `title` | topic title | padded to 3 characters, cut at 250 |
| `selftext` | first post body | first 600 characters, cut at a word, then a link back |
| `url` (link posts) | appended to the body | |
| `permalink` | "Read the full post and reply on Reddit" link | |
| `author` | **not shown** by default ("Shared from r/closetrepublic") | `ingest.author: "shown"` names them |
| `link_flair_text` | category via `flairToCid`, else `defaultCid` | flairs in `skipFlairs` are not copied |
| `over_18` | skipped unless `allowNsfw` | |
| `removed_by_category`, `[removed]`, `[deleted]` | never copied; later removal hides the copy | |
| `created_utc` | used for the age window only | the topic is dated when it was copied |
| tags | `from-reddit` on every copy | |

**Reddit comment (t1) → forum reply** (only with `mirrorComments`): `body` → reply text with "A Redditor on Reddit" and a link; `parent_id` → `toPid` when the parent was mirrored too.

**Forum topic → Reddit link post**

| Forum | Reddit | Rule |
|---|---|---|
| tags | | must include `share-to-reddit` (the author's consent) |
| `cid` | | must be in `publish.cids` (public categories only) |
| author's rank | | optional `publish.minTier` (off by default, so any member can share) |
| title | title | optional `titlePrefix`, cut at 300 |
| topic URL | link URL | the post links to the forum; the text stays on the forum |
| author | **never sent** | Reddit only sees the bot account |

### 2.3 Rate-limit guardrails

Reddit's free tier allows 100 requests per minute per OAuth app. The bridge stays well under it:

- A sliding one-minute window capped at `REDDIT_MAX_QPM` (60).
- Reddit's `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` headers are honoured, keeping a reserve of 5 so other tools on the same app are never starved.
- 429 and 5xx answers back off exponentially (2 s, 4 s, 8 s... up to 5 minutes), or for exactly `Retry-After` when Reddit sends it.
- An expired token is refreshed once, then the call is retried.
- A normal hour uses about 30 calls for ingest plus 4 for reconcile, roughly 1 per minute. Turning on comment mirroring adds one call per recent topic per poll.

Two Reddit-side limits matter as much as the API cap: new bot accounts get caught by Reddit's spam filter, so make the bot account an approved user and moderator of r/closetrepublic; and Reddit now reviews new API apps before issuing credentials. Until access is approved, `REDDIT_MODE=rss` ingests from the public feed with no credentials (new posts only, no flair, no removal checks).

### 2.4 RSS and ActivityPub ingestion

| Source | Mode | What it can do |
|---|---|---|
| Reddit API | `REDDIT_MODE=api` | everything above |
| Reddit RSS (`/r/closetrepublic/new/.rss`) | `REDDIT_MODE=rss` | ingest new posts only, read-only, no flair routing, no removal checks |
| Fediverse (Lemmy, Mastodon, PieFed) | NodeBB built in | category synchronization, no bridge needed |

### 2.5 Moderation reconciliation

| What happens | Where | What the bridge does |
|---|---|---|
| Moderator, AutoModerator or Reddit admins remove a post | Reddit | hides the forum copy at the next reconcile (soft delete, reversible) |
| The author deletes their Reddit post | Reddit | hides the forum copy |
| Moderators approve it again | Reddit | restores the forum copy |
| The Reddit post is edited | Reddit | updates the forum copy's excerpt |
| A new post sits in AutoModerator's queue | Reddit | not copied: posts younger than 10 minutes are skipped so Reddit moderation acts first |
| A forum moderator hides a copied topic | forum | recorded only; the bot is not a Reddit moderator by design |
| A shared topic is deleted (by its author or a moderator) | forum | deletes the bot's Reddit link post |
| A shared topic is restored | forum | recorded; it is not posted to Reddit again automatically |
| A member deletes their forum account | forum | every Reddit link post of theirs is deleted |
| The bot's link post is removed by Reddit moderators | Reddit | recorded; the forum topic stays |

Every action is written to the bridge's `audit` table with no personal data (no emails, no usernames).

---

## 3. Identity and role federation

### 3.1 Recommended approach: Discord OAuth2 through a custom plugin

Members sign in with Discord. The plugin (`nodebb-plugin-closet-republic`) handles the OAuth2 flow and the bridge decides ranks.

Why this one:

- Discord is where the ranks already live, so Discord identity is the natural anchor. Buy Me a Coffee has no login API, so it can't be a login provider; it is matched by email instead.
- **Pseudonyms by default.** A new member's forum name is `citizen-xxxxxx`, never their Discord name, and the Discord link is stored privately. The forum alone doesn't reveal who someone is on Discord. Members can rename themselves.
- It is about 200 lines of Closet Republic code, tested on NodeBB 4.16.3.

Alternatives considered:

| Option | Why not (now) |
|---|---|
| `nodebb-plugin-sso-oauth2-multiple` (official) | Tested: Discord's profile has none of the name fields it expects, so login fails, or with "username from email" it publishes the email's first half as the username |
| `nodebb-plugin-sso-discord-alt` | Last release 2022, written for NodeBB 2 |
| Session sharing (JWT cookie from closetrepublic.com) | The main site has no member accounts to share. This becomes the right choice if the site gains member logins later |
| DiscourseConnect | A Discourse protocol; NodeBB has no consumer for it |
| Webhook listener only, no SSO | Members would need separate forum passwords and a manual linking step |

Local email-and-password login stays available as the fallback (section 1.2).

### 3.2 Tier mapping

Every tier is a paid Buy Me a Coffee membership, and the rank follows the price, as on the membership page:

| Rank | Tier (NodeBB group) | Buy Me a Coffee level | Price | Badge |
|---|---|---|---|---|
| 0 | Alien | alien | $1/month | grey, astronaut |
| 1 | Citizen | citizen | $3/month | blue, ID card |
| 2 | Top 1% | In dictator's bed | $5/month | amber, crown |
| 3 | Upper Middle Class | Upper middle class | $6/month | purple, gem |
| 4 | Middle Class | Middle class | $8/month | green, mug |

- Members with no paid tier are in no tier group and wear no badge. They can still sign in, read public categories and post where the privileges below allow, because the forum is where public ideas go.
- A member gets the **highest** tier any source gives them (a Discord tier role, or an active membership) and belongs to exactly one tier group. The group sets the badge next to their name and, through category privileges, what they can read and post.
- A cancelled membership keeps its tier until the end of the paid period plus `graceDays` (7), then drops to no tier.
- A membership level the config doesn't know yet (say, a new one) counts as Alien until it's added (`bmcUnknownLevelTier`).

These are the settings in [`cr-bridge/config/roles.json`](../cr-bridge/config/roles.json), with the Discord server and role ids already filled in. Levels are matched by Buy Me a Coffee level id first (`bmcLevelIds`, which survives renaming a level), then by name (`bmcLevels`, case doesn't matter). This order, the grace period and the paid-only rule match the Discord plan. If the tier order changes, only the `rank` numbers change.

Suggested category privileges (set in ACP > Manage > Privileges; the bridge does not change privileges):

| Category | Read | Post | fediverse | Reddit |
|---|---|---|---|---|
| Announcements | everyone | admins | yes | share by tag |
| Public Square | everyone | any signed-in member | yes | share by tag |
| From r/closetrepublic | everyone | any signed-in member (replies) | no | ingest target |
| Border Post (newcomers, questions) | signed in | any signed-in member | no | no |
| Republic Hall | Alien and up | Alien and up | no | no |
| Citizens' Assembly | Citizen and up | Citizen and up | no | no |
| Inner Circle | Top 1% and up | Top 1% and up | no | no |
| Upper Floors | Upper Middle Class and up | same | no | no |
| Middle Class Lounge | Middle Class | Middle Class | no | no |
| Safe Room | Alien and up, hidden from guests and search engines | Alien and up | never | never |

"X and up" means granting the privilege to that tier's group and every higher one. Tier groups are private, can't be joined or left by members, and only the bridge changes membership.

### 3.3 How a rank change reaches the forum

```
Discord role added/removed ──(gateway: GUILD_MEMBER_UPDATE)──┐
Buy Me a Coffee membership ──▶ closetrepublic.com webhook    │
     started/updated/cancelled    (existing HMAC check,      ├──▶ cr-bridge: computeTier(uid)
                                  treasury) ──forwards──────▶┤      = max(Discord tier, BMC tier)
Member logs in with Discord ──(plugin "login" event)────────┤      ──▶ NodeBB Write API:
Every 6 hours ──(full reconcile of linked members)──────────┘          join new tier group,
                                                                       leave the others,
                                                                       set badge (groupTitle);
                                                                       no paid tier = no group
```

- **Discord**: a read-only bot with the Server Members intent listens for role changes and reads roles on demand. It never assigns roles, so it can't fight Buy Me a Coffee's own Discord integration if that grants the Discord roles.
- **Buy Me a Coffee**: builds on the site's existing webhook rather than adding a second one. After `/api/webhooks/buymeacoffee` verifies the signature, it forwards the raw event to the bridge, signed with the shared secret (snippet in [main-site-changes.md](main-site-changes.md)). The bridge also accepts Buy Me a Coffee's signature directly, at `https://forum.closetrepublic.com/bridge/webhooks/bmc`, if a second webhook is ever preferred. Membership state is kept per supporter email; a cancelled membership keeps its rank until the paid period ends.
- **Matching**: a Buy Me a Coffee supporter is matched to the forum account with the same confirmed email. The plugin stores the member's Discord email only when Discord says it is verified, and NodeBB keeps emails private. Members whose Buy Me a Coffee email differs can add that email to their forum account.
- **Safety**: if Discord is configured but unreachable, the bridge skips the recompute instead of downgrading anyone. Retried webhooks are ignored by event id.

### 3.4 Secrets and trust

| Secret | Held by | Used for |
|---|---|---|
| `CR_BRIDGE_SECRET` | plugin, bridge, main site | HMAC on forum events and forwarded BMC events |
| `NODEBB_TOKEN` (master token, acts as `reddit-bridge`, an admin) | bridge only | forum writes |
| `CR_ADMIN_TOKEN` | the operator | `POST /admin/run/<ingest\|reconcile\|roles>` on 127.0.0.1 |
| Discord client secret | plugin | OAuth2 |
| Discord bot token | bridge | reading roles |
| Reddit app secret and bot password | bridge | Reddit API |

All of them live in `/etc/closet-republic/*.env` (readable by root and the `nodebb` user only), never in a repository.
