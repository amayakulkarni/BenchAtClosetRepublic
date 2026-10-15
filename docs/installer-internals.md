# Guide: building the production setup script

[`install-forum.sh`](../install-forum.sh) is the finished script. This guide explains how it is built, as a reference for changing it, extending it, and trusting it on the production server. It has been run end to end on a clean Ubuntu 24.04 (with Redis), and run a second time over itself to check that a re-run changes nothing it shouldn't.

## 1. Rules the script follows

| Rule | Why | How |
|---|---|---|
| Re-runnable | Upgrades and fixes use the same script as the first install | every step checks what exists first (`[[ -d ... ]]`, `id nodebb`, `[ -f config.json ]`) |
| Secrets made once | Re-running must never change a password the database already uses | `env_set` only fills empty values in `/etc/closet-republic/*.env` |
| Pinned versions | Production gets exactly what was tested | `--nodebb-version v4.16.3`, `pm2@6`, `npm ci` from the bridge's lockfile |
| Localhost only | Only nginx faces the internet | NodeBB `bind_address 127.0.0.1`, bridge `CR_BRIDGE_HOST=127.0.0.1`, MongoDB/Redis bound to 127.0.0.1 with passwords |
| Own user | A forum bug can't touch the main site | everything runs as the `nodebb` system user with its own pm2 |
| Own Node.js | Installing or upgrading the forum never replaces the Node.js the main site (and its native modules such as better-sqlite3) was built against | official Node.js 22 in `/opt/closet-republic/node`, used through `PATH` for the `nodebb` user and as pm2's `interpreter`; the system `node` is only reported, never changed |
| Fixed ports | 40001 to 40005 belong to the main site | NodeBB 40006, bridge 40007; preflight refuses if something else holds them |
| Look before acting | Every command is visible first | `--dry-run` prints each command instead of running it |
| Nothing surprising | Never lock anyone out or overwrite manual edits | firewall only with `--firewall`; nginx site and bridge `config/` are written only if missing |
| Testable in pieces | Each step can be tried alone | sourcing the file defines the functions without running `main` |

## 2. The steps, in order

```
main
├─ preflight                 root? Ubuntu 22.04/24.04 or Debian 12/13? ports 40006/40007 free? DNS points here?
├─ install_packages          apt: nginx, certbot, jq, sqlite3, rsync, ufw (the server's Node.js is left alone)
├─ prepare_user_and_secrets  user "nodebb", /opt/closet-republic, /etc/closet-republic/{forum,bridge}.env
├─ install_node              official Node.js 22 tarball (SHA-256 pinned) → /opt/closet-republic/node; pm2 inside it;
│                            /usr/local/bin/forum-pm2 wrapper
├─ install_database          MongoDB 8.0 with auth (users first, then auth on) or Redis with a password
├─ install_nodebb            git clone tag → npm install → ./nodebb setup (from env vars) →
│                            config.json: port 40006, 127.0.0.1, trust_proxy → plugin → activate →
│                            reddit-bridge admin account → Write API token → ./nodebb build
├─ install_bridge            rsync cr-bridge (keeps config/ and data/) → npm ci
├─ configure_pm2             ecosystem.forum.config.cjs (interpreter = the forum's Node.js) → pm2 startOrReload →
│                            pm2 save → boot service
├─ configure_nginx           site for --domain, websockets, /bridge/webhooks/ only → certbot
├─ configure_firewall        only with --firewall
├─ configure_backups         /opt/closet-republic/backup-forum.sh + cron at 03:15
├─ verify                    127.0.0.1:40006 answers, bridge /healthz answers
└─ summary                   what's left to do by hand
```

Three details worth knowing:

- **NodeBB without questions.** `./nodebb setup` normally asks questions. It also reads `NODEBB_URL`, `NODEBB_PORT`, `NODEBB_ADMIN_*` and `NODEBB_DB*` from the environment, so the script passes everything that way and NodeBB writes `config.json` itself. `jq` then pins the port, the localhost binding and the URL, so a re-run with a new `--domain` updates them.
- **The bridge's forum account and token.** `./nodebb user create reddit-bridge` and `./nodebb user make admin <uid>` are NodeBB's own CLI. NodeBB has no CLI for API tokens, so `scripts/nodebb-master-token.cjs` loads NodeBB's code from its folder and calls its token function; it prints the existing token on later runs instead of making another.
- **Environment for pm2.** `forum.env` is read by the ecosystem file when pm2 loads it, which is why changing it needs `pm2 startOrReload ... --update-env`. The bridge reads `bridge.env` itself (`node --env-file`) on every start, so a plain `pm2 restart cr-bridge` is enough.

## 3. Options and variables

| Flag | Default | Notes |
|---|---|---|
| `--domain` | (required) | `forum.closetrepublic.com` in production, `localhost` on WSL |
| `--email` | (required) | NodeBB admin and Let's Encrypt |
| `--db mongo\|redis` | mongo | Redis if the CPU has no AVX or the server is small |
| `--nodebb-version` | v4.16.3 | any NodeBB git tag |
| `--no-tls` | off | plain http, no certbot |
| `--firewall` | off | ufw: SSH, 80, 443 only. Check the main site is reached through nginx first |
| `--dry-run` | off | print only |

Fixed values at the top of the script: `NODEBB_PORT=40006`, `BRIDGE_PORT=40007`, `BASE=/opt/closet-republic`, `ETC=/etc/closet-republic`, `RUN_USER=nodebb`.

## 4. Changing or adding a step

1. Write it as a function next to the others. Use `run` for any command that changes something (so `--dry-run` shows it), `as_user <dir> "<command>"` for anything NodeBB or the bridge owns, `info` and `say` for output, `die` to stop with a reason.
2. Make it safe to repeat: check before creating, never regenerate a secret that exists.
3. Add it to `main` in the right place.
4. Under `set -euo pipefail`, a function whose last command is a failed test (`[[ x ]] && something`) returns failure and stops the script. End such lines with an `if`, as the script does.
5. Check it: `bash -n install-forum.sh`, `shellcheck install-forum.sh`, then a dry run.

Example, adding a step that sets the forum's title through the bridge's API token after pm2 has started:

```bash
configure_forum_settings() {
  say "Setting forum title"
  local token; token="$(env_get "$BRIDGE_ENV" NODEBB_TOKEN)"
  run curl -fsS -X PUT "http://127.0.0.1:$NODEBB_PORT/api/v3/admin/settings/title" \
    -H "Authorization: Bearer $token" -H 'content-type: application/json' \
    -d '{"_uid": 1, "value": "Closet Republic Forum"}'
}
```

and call it after `verify` in `main`.

## 5. Testing the script

| Level | How |
|---|---|
| Syntax | `bash -n install-forum.sh && shellcheck -S warning install-forum.sh` |
| Plan | `sudo ./install-forum.sh --domain localhost --email admin@example.com --no-tls --dry-run` |
| One step | `sudo bash -c 'set --; source ./install-forum.sh; DOMAIN=localhost ADMIN_EMAIL=admin@example.com SCHEME=http CODENAME=noble; install_bridge'` |
| Whole run | a fresh WSL distribution (`wsl --install -d Ubuntu-24.04 --name cr-test`, remove with `wsl --unregister cr-test`) or a throwaway VPS |
| Re-run | run it twice; the second run should only print checks and "already exists" lines, and the forum must keep working |

Run the whole thing on the test machine before every production run, especially before changing `--nodebb-version`.

## 6. Keeping it with the code

Commit the `forum` folder (script, plugin, bridge, guides) to the ClosetRepublic repository, for example under `forum/`. Never commit anything from `/etc/closet-republic`, the bridge's `data/` folder or a `.env` file. On the server, `git pull` and re-run the script to deploy changes.

## 7. Upgrades and rollback

- **Upgrade NodeBB**: back up (`sudo /opt/closet-republic/backup-forum.sh`), then re-run with `--nodebb-version vX.Y.Z`. NodeBB runs its own database upgrades on start.
- **Roll back NodeBB**: re-run with the old tag and restore the database from the backup taken just before (database upgrades are one-way).
- **Upgrade the bridge or plugin**: copy the new folder, re-run the script. Bridge `config/` and `data/` are kept.
