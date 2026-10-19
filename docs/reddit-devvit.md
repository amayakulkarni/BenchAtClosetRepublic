# Guide: connecting Reddit through Devvit

Reddit now asks new apps to use Devvit, its own app platform, instead of a Reddit API key. This guide connects the forum to r/closetrepublic that way. The sync itself (what gets copied, consent tag, removals) works exactly as described in [reddit-sync.md](reddit-sync.md); only the connection changes.

## How it works

- `reddit-app/` holds a small Devvit app named **closetrepublic-sync**. It is installed in r/closetrepublic and runs on Reddit's servers.
- The forum's bridge (cr-bridge) calls the app over HTTPS with a secret app token, through five addresses: new posts, current state of posts and comments, a post's comments, share a forum topic, delete a shared post.
- The app never contacts the forum. Reddit does not approve apps that send data to personal websites, so the bridge always asks and the app only answers.
- Forum topics shared to Reddit appear as link posts by **u/closetrepublic-sync** (the app's own account). No personal Reddit account or password is stored on the forum server.

| Without Devvit (`REDDIT_MODE=rss`) | With Devvit (`REDDIT_MODE=devvit`) |
|---|---|
| New Reddit posts copied to the forum | New Reddit posts copied to the forum |
| | Reddit comments copied (if `mirrorComments` is on) |
| | Forum topics tagged `share-to-reddit` shared to Reddit |
| | Posts removed on Reddit hidden on the forum, and the other way round |

## What is needed

- The Windows PC with the forum folder (`F:\ClosetRepublicDev\forum`).
- Node.js 24 or newer on that PC (nodejs.org, "LTS" installer). Check with `node -v` in PowerShell.
- The Reddit account that moderates r/closetrepublic.
- A private test subreddit, **r/closetrepublic_test**, moderated by the same account (create it at reddit.com/subreddits/create, set it to private).

## 1. Ask Reddit for "external endpoints"

The bridge reaches the app through Devvit's **external endpoints**, which Reddit enables per app on request.

1. Open the request form linked from Devvit's documentation page "External Endpoints" (developers.reddit.com/docs, search "External Endpoints").
2. App name: `closetrepublic-sync`. Reason, for example:
   > A moderator tool for r/closetrepublic. The subreddit's own community forum (closetrepublic.com) calls the app with a managed token to read new posts and removals, and to share forum topics that their authors chose to share. The app makes no outgoing requests.
3. Wait for the reply. Steps 2 to 4 can be done in the meantime.

## 2. Log in to Devvit on the PC

In PowerShell:

```powershell
cd F:\ClosetRepublicDev\forum\reddit-app
npm install
npx devvit login
```

A browser window opens; log in with the moderator account and allow access.

If the name `closetrepublic-sync` is already taken on Devvit, change `"name"` in `reddit-app\devvit.json` to another free name (3 to 20 lowercase letters, numbers and hyphens). That name is also the app's Reddit username.

## 3. Try it in the test subreddit

```powershell
npm run dev
```

This builds the app and installs a test version in r/closetrepublic_test (set in `devvit.json` under `dev`). In r/closetrepublic_test, open the moderator menu (the "..." or shield menu at the top of the subreddit) and choose **Forum bridge address**. Once external endpoints are enabled, it shows an address like `https://closetrepublic-sync-abc123-external.devvit.net/external/`. Stop the test with Ctrl+C.

## 4. Publish the app and install it

```powershell
npm run deploy
```

This uploads the app to Reddit for review. Reddit's app review usually takes about a week. When it is approved:

1. Open https://developers.reddit.com/apps/closetrepublic-sync and click **Install**, then choose r/closetrepublic.
2. In r/closetrepublic, add **u/closetrepublic-sync** as an approved user, so Reddit's spam filter does not remove the shared posts.

## 5. Create the app token

1. Open https://developers.reddit.com/apps/closetrepublic-sync/developer-settings.
2. Under app tokens, create a new token named `forum-bridge`.
3. Copy the secret (it starts with `devvit_at_`). It is shown only once; if it is lost, revoke it and create a new one.

## 6. Get the address

In r/closetrepublic, open the moderator menu and choose **Forum bridge address**. Copy the address shown.

## 7. Connect the bridge

On the forum server:

```bash
sudo nano /etc/closet-republic/bridge.env
```

Set these lines (and leave the `REDDIT_CLIENT_*`, `REDDIT_USERNAME` and `REDDIT_PASSWORD` lines empty):

```
REDDIT_MODE=devvit
REDDIT_SUBREDDIT=closetrepublic
DEVVIT_URL=https://closetrepublic-sync-abc123-external.devvit.net/external/
DEVVIT_TOKEN=devvit_at_...
CR_DRY_RUN=true
```

Also check that `ingest.defaultCid` in `/opt/closet-republic/cr-bridge/config/sync.json` is the forum category for Reddit posts, and that `publish.cids` lists the categories allowed to share (see [reddit-sync.md](reddit-sync.md#2-settings-in-syncjson)).

Restart the bridge and read its log:

```bash
sudo forum-pm2 restart cr-bridge
sudo forum-pm2 logs cr-bridge --lines 30 --nostream
```

A line containing `Devvit app refused the request` means the token or the address is wrong. No such line means the connection works.

With `CR_DRY_RUN=true` the bridge only records what it would do (see [reddit-sync.md, stage 2](reddit-sync.md#stage-2-a-private-test-subreddit-in-dry-run) for how to read it). When that looks right, set `CR_DRY_RUN=false` and restart the bridge again.

## Changing the app later

Edit `reddit-app\src\server\index.ts`, then run `npm run deploy` again from `reddit-app`. Each new version goes through Reddit's review before r/closetrepublic gets it. The bridge needs no change unless the addresses change.

## When something looks wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `Devvit app refused the request (401)` | wrong or revoked token | create a new token (step 5) and update `DEVVIT_TOKEN` |
| `Devvit app ... returned 404` | wrong address, or the app is not installed in the subreddit | copy the address again from the menu (step 6) |
| "Forum bridge address" says the address can't be fetched | external endpoints not enabled yet for the app | wait for Reddit's reply to step 1 |
| Shared posts vanish on Reddit | spam filter | approve u/closetrepublic-sync in the subreddit (step 4) |
| Reddit refuses the app or external endpoints | Reddit policy | keep `REDDIT_MODE=rss`; new Reddit posts are still copied |
