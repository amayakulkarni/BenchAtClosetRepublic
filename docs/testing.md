# Testing the forum in detail (optional)

This checks every feature with a **fake Reddit** and a **fake Discord** that come with the bridge, so nothing touches real accounts. Run it on the PC after [INSTALL.md](../INSTALL.md) Part A.

## 1. Useful commands

Run these in Ubuntu:

```bash
sudo forum-pm2 ls                       # are both parts running?
sudo forum-pm2 logs cr-bridge --lines 50
curl -s 127.0.0.1:40007/healthz
# run one of the bridge's jobs now instead of waiting for its timer:
TOKEN=$(sudo grep ^CR_ADMIN_TOKEN= /etc/closet-republic/bridge.env | cut -d= -f2)
curl -s -XPOST -H "Authorization: Bearer $TOKEN" 127.0.0.1:40007/admin/run/ingest   # or reconcile, roles
```

## 2. Set up test categories

In the forum: ACP > Manage > Categories, create **Public Square** and **From r/closetrepublic**. Note their ids (the number in `/category/<id>/...`). Then in ACP > Manage > Privileges, take `fediverse` off **From r/closetrepublic**.

For testing, also switch off the new-member limits to allow quick posting: ACP > Settings > Posts > "Post Queue" off, and the new-user posting delay to 0. Switch them back on in production.

Edit the bridge rules:

```bash
sudo nano /opt/closet-republic/cr-bridge/config/sync.json
```

Set `ingest.defaultCid` to the From r/closetrepublic id and `publish.cids` to `[<Public Square id>]`.

## 3. Reddit sync with the fake Reddit

The bridge comes with a small fake Reddit (`test/mock-reddit.mjs`) that behaves like the endpoints the bridge uses.

```bash
cd /opt/closet-republic/cr-bridge
sudo -u nodebb nohup node test/mock-reddit.mjs > /tmp/fake-reddit.log 2>&1 &
```

Point the bridge at it by adding these to `/etc/closet-republic/bridge.env`, then restart the bridge:

```
REDDIT_MODE=api
REDDIT_API_BASE=http://127.0.0.1:40017
REDDIT_AUTH_BASE=http://127.0.0.1:40017
REDDIT_RSS_BASE=http://127.0.0.1:40017
REDDIT_CLIENT_ID=fake
REDDIT_CLIENT_SECRET=fake
REDDIT_USERNAME=closetrepublic_bot
REDDIT_PASSWORD=fake
```
```bash
sudo forum-pm2 restart cr-bridge
```

Then go through the scenarios. `M=http://127.0.0.1:40017`.

| # | Do this | Expect |
|---|---|---|
| 1 | `curl -XPOST $M/_mock/post -d '{"title":"Hello from Reddit","selftext":"First test","author":"someone","ageMinutes":30}'` then run the ingest job | A topic in From r/closetrepublic with the excerpt, tag `from-reddit`, "Shared from r/closetrepublic" and a link. **No Reddit username.** |
| 2 | Same with `"ageMinutes":2` | Not copied yet (too new: AutoModerator gets 10 minutes first) |
| 3 | Same with `"flair":"Meta"` | Never copied (skipped flair) |
| 4 | Run ingest again | Nothing new (no duplicates) |
| 5 | `curl -XPOST $M/_mock/remove/t3_<id>` then run reconcile | The forum copy is hidden (deleted state) |
| 6 | `curl -XPOST $M/_mock/approve/t3_<id>` and `curl -XPOST $M/_mock/edit/t3_<id> -d '{"selftext":"Edited"}'`, then reconcile | The copy is back, with the new excerpt |
| 7 | As a normal member, post a topic in Public Square with the tag `share-to-reddit` | `curl -s $M/_mock/state` shows a new link post by `closetrepublic_bot` pointing at the topic. The member's name is not in it. |
| 8 | Post a topic without the tag | Nothing goes to Reddit |
| 9 | Delete the topic from step 7 | The fake shows that link post as `[deleted]` |
| 10 | Set `"mirrorComments": true`, `curl -XPOST $M/_mock/comment -d '{"postId":"t3_<id>","body":"Nice!"}'`, run ingest | A reply "Nice! … A Redditor on Reddit" under the copied topic |

Find the ids with `curl -s $M/_mock/state`. The bridge's own view of what is linked to what:

```bash
sudo sqlite3 /opt/closet-republic/cr-bridge/data/bridge.db "SELECT reddit_id, origin, tid, state FROM sync_map;"
sudo sqlite3 /opt/closet-republic/cr-bridge/data/bridge.db "SELECT datetime(at,'unixepoch'), action, detail FROM audit ORDER BY id DESC LIMIT 20;"
```

## 4. Tier badges from made-up Buy Me a Coffee events

Create a member with a known email (ACP > Manage > Users > New User, then confirm the email in their profile), or log in with Discord (step 5). Then, from `/opt/closet-republic/cr-bridge`:

```bash
E=--env-file=/etc/closet-republic/bridge.env
sudo -u nodebb node $E test/send-bmc.mjs membership.started member@example.com "citizen"
sudo -u nodebb node $E test/send-bmc.mjs membership.updated member@example.com "Middle class"
sudo -u nodebb node $E test/send-bmc.mjs membership.cancelled member@example.com
```

| After | Expect on the member's profile |
|---|---|
| started, citizen | Citizen badge, member of the Citizen group |
| updated, Middle class | Middle Class badge only (one tier group at a time) |
| cancelled (no period end given) | still Middle Class: the grace period (7 days) counts from now |
| any level the config doesn't know, e.g. "Patron" | Alien (`bmcUnknownLevelTier`) |

To see a cancelled membership run out without waiting, set `"graceDays": 0` in `config/roles.json`, restart the bridge and run the reconcile job: the badge disappears and the member leaves every tier group.

## 5. "Log in with Discord" with the fake Discord

```bash
cd /opt/closet-republic/cr-bridge
sudo -u nodebb nohup env MOCK_DISCORD_EMAIL=member@example.com node test/mock-discord.mjs > /tmp/fake-discord.log 2>&1 &
```

In `/etc/closet-republic/forum.env` set:

```
CR_DISCORD_CLIENT_ID=fake
CR_DISCORD_CLIENT_SECRET=fake
CR_DISCORD_BASE=http://127.0.0.1:40018
```

Reload NodeBB so it picks up the new environment:

```bash
sudo forum-pm2 startOrReload /opt/closet-republic/ecosystem.forum.config.cjs --update-env
```

In a private browser window, open `http://localhost/login` and click **Log in with Discord**. The fake approves at once.

Expect:
- a new account named `citizen-` plus six characters (not `real_discord_name`)
- NodeBB's registration-completion page (terms and privacy consent), which is normal for new accounts
- the email `member@example.com` saved as confirmed and not visible on the public profile
- in the bridge log, `tier.changed … reason: login` (no tier unless step 4 gave that email a membership)
- logging in again lands on the same account

Remove `CR_DISCORD_BASE` (and the fake values) before testing with the real Discord.

## 6. The real Discord and a test subreddit

When the fakes pass:

1. **Discord**: create a test server and an application at discord.com/developers. OAuth2 redirect: `http://localhost/auth/discord/callback` (option B: `https://staging-forum.closetrepublic.com/auth/discord/callback`). Put the client id and secret in `forum.env`. Add a bot, switch on **Server Members Intent**, invite it to the test server (it needs no permissions), and put `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` in `bridge.env`. Copy the five tier role ids into `config/roles.json`. Give a test account a tier role and check that the forum badge changes within seconds; remove the role and check that it goes.
2. **Reddit**: follow [reddit-sync.md](reddit-sync.md) with a private test subreddit such as r/closetrepublic_test (`REDDIT_SUBREDDIT=closetrepublic_test`).

## 7. Privacy checks before going live

- [ ] New Discord accounts get `citizen-xxxxxx` names; the Discord name and id appear nowhere public
- [ ] Member emails are hidden on profiles. NodeBB hides them unless a member opts in; switch on ACP > Settings > User > "Hide email" so nobody can show theirs by accident
- [ ] Reddit copies don't name the Redditor; Reddit link posts don't name the forum author
- [ ] Only Announcements and Public Square have the `fediverse` privilege
- [ ] Safe Room is invisible when logged out and to members without a tier
- [ ] A Discord-created account can add a password in Settings (the fallback if Discord goes away)
- [ ] Deleting a test account deletes its shared Reddit link posts

## Restore a backup

Do this once on the PC (Part A of INSTALL.md) to prove the restore works before it is ever needed.

```bash
sudo ./install-forum.sh --domain localhost --email admin@example.com --no-tls   # fresh install
sudo forum-pm2 stop all
B=/path/to/backups/2026-10-15
P="$(sudo grep ^DB_PASSWORD= /etc/closet-republic/forum.env | cut -d= -f2)"
mongorestore --drop --gzip --archive=$B/nodebb.mongo.gz -u nodebb -p "$P" --authenticationDatabase nodebb
sudo tar -xzf $B/uploads.tar.gz -C /opt/closet-republic/nodebb/public
sudo cp $B/bridge.db /opt/closet-republic/cr-bridge/data/bridge.db
sudo cp -r $B/bridge-config/. /opt/closet-republic/cr-bridge/config/
sudo chown -R nodebb:nodebb /opt/closet-republic
sudo forum-pm2 start all
```

(Redis: stop Redis, copy `nodebb.redis.rdb` to `/var/lib/redis/dump.rdb`, start Redis.) Restoring to a new server is the same, then pointing DNS at it.
