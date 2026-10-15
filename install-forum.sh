#!/usr/bin/env bash
# Closet Republic forum: production setup for a fresh or existing Ubuntu 22.04/24.04 server.
#
# Installs and wires up:
#   NodeBB (pinned version) on 127.0.0.1:40006   + nodebb-plugin-closet-republic
#   cr-bridge (Reddit sync, role tiers)  on 127.0.0.1:40007
#   MongoDB 8.0 (default) or Redis, Node.js 22, pm2 (under a dedicated "nodebb" user),
#   nginx reverse proxy with Let's Encrypt TLS, nightly backups.
# Ports 40001-40005 belong to the main site and are never touched.
#
# Usage (as root, from the forum folder, which holds this script, cr-bridge/ and nodebb/plugin/):
#   sudo ./install-forum.sh --domain forum.closetrepublic.com --email you@example.com
# Options:
#   --domain NAME        public forum hostname (DNS A/AAAA record must already point here)
#   --email ADDRESS      admin email for NodeBB and Let's Encrypt
#   --db mongo|redis     database (default mongo)
#   --nodebb-version TAG NodeBB git tag (default v4.16.3)
#   --no-tls             skip certbot and serve plain http (test machines: WSL, a VM, a staging
#                        box without public DNS). Use with --domain localhost on WSL.
#   --firewall           also enable ufw (allows SSH + HTTP/HTTPS only). Off by default so the
#                        main site's existing access is never cut by surprise.
#   --dry-run            print what would happen, change nothing
#
# Safe to re-run: every step checks what already exists. Secrets are generated once into
# /etc/closet-republic/ and reused afterwards.
set -euo pipefail

# ---------------------------------------------------------------- settings
DOMAIN=""
ADMIN_EMAIL=""
DB_KIND="mongo"
NODEBB_VERSION="v4.16.3"
NODEBB_PORT=40006
BRIDGE_PORT=40007
WITH_TLS=1
SCHEME=https
WITH_FIREWALL=0
DRY_RUN=0

BASE=/opt/closet-republic
NODEBB_DIR=$BASE/nodebb
BRIDGE_DIR=$BASE/cr-bridge
BACKUP_DIR=$BASE/backups
ETC=/etc/closet-republic
FORUM_ENV=$ETC/forum.env
BRIDGE_ENV=$ETC/bridge.env
RUN_USER=nodebb
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) ADMIN_EMAIL="$2"; shift 2 ;;
    --db) DB_KIND="$2"; shift 2 ;;
    --nodebb-version) NODEBB_VERSION="$2"; shift 2 ;;
    --no-tls) WITH_TLS=0; SCHEME=http; shift ;;
    --firewall) WITH_FIREWALL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- helpers
say()  { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if [[ $DRY_RUN -eq 1 ]]; then printf '    + %s\n' "$*"; else "$@"; fi; }
# Run a shell snippet as the service user, from a given folder.
as_user() { local dir="$1"; shift; run sudo -u "$RUN_USER" -H bash -c "cd '$dir' && $*"; }
rand() { openssl rand -hex "${1:-24}"; }
env_get() { [[ -f "$1" ]] && grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- || true; }
env_set() { # file key value (adds or replaces)
  local file="$1" key="$2" value="$3"
  [[ $DRY_RUN -eq 1 ]] && { info "+ set $key in $file"; return; }
  touch "$file"
  if grep -qE "^$key=" "$file"; then
    local tmp; tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" -F= 'BEGIN{OFS="="} $1==k {print k, v; next} {print}' "$file" > "$tmp" && cat "$tmp" > "$file" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# ---------------------------------------------------------------- 1. preflight
preflight() {
  say "Checking the server"
  [[ $EUID -eq 0 || $DRY_RUN -eq 1 ]] || die "run as root (sudo)"
  [[ -n "$DOMAIN" ]] || die "--domain is required (e.g. forum.closetrepublic.com)"
  [[ -n "$ADMIN_EMAIL" ]] || die "--email is required"
  [[ "$DB_KIND" == mongo || "$DB_KIND" == redis ]] || die "--db must be mongo or redis"
  [[ -d "$SRC_DIR/cr-bridge" && -d "$SRC_DIR/nodebb/plugin" ]] \
    || die "cr-bridge/ and nodebb/plugin/ must sit next to this script (run it from the forum folder)"

  . /etc/os-release 2>/dev/null || true
  CODENAME="${VERSION_CODENAME:-unknown}"
  case "$CODENAME" in
    jammy|noble) info "Ubuntu $CODENAME" ;;
    *) [[ $DRY_RUN -eq 1 ]] && info "OS: $CODENAME (dry run, continuing)" || die "tested on Ubuntu 22.04 (jammy) and 24.04 (noble); found '$CODENAME'" ;;
  esac

  command -v ss >/dev/null || die "the 'ss' command is missing (apt-get install iproute2)"
  for port in $NODEBB_PORT $BRIDGE_PORT; do
    if ss -ltnp 2>/dev/null | grep -qE "[:.]$port\b" && ! ss -ltnp 2>/dev/null | grep -E "[:.]$port\b" | grep -qE 'node|PM2'; then
      die "port $port is used by something other than this forum"
    fi
  done
  for port in 40001 40002 40003 40004 40005; do
    if ss -ltn 2>/dev/null | grep -qE "[:.]$port\b"; then info "port $port in use by the main site (left alone)"; fi
  done

  local here there
  here="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  there="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  if [[ $WITH_TLS -eq 1 && -n "$here" && "$here" != "$there" ]]; then
    info "WARNING: $DOMAIN resolves to '${there:-nothing}', this server is $here."
    info "Let's Encrypt will fail until DNS points here (or re-run with --no-tls)."
  fi
}

# ---------------------------------------------------------------- 2. packages
install_packages() {
  say "Installing system packages"
  run apt-get update -y
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y curl git build-essential ca-certificates gnupg \
    nginx certbot python3-certbot-nginx jq openssl sqlite3 rsync ufw

  local major=0
  command -v node >/dev/null && major="$(node -p 'process.versions.node.split(".")[0]')"
  if (( major < 22 )); then
    info "Installing Node.js 22 (found ${major})"
    if [[ $DRY_RUN -eq 0 ]]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; fi
    run apt-get install -y nodejs
  else
    info "Node.js $(node -v) already installed"
  fi
  command -v pm2 >/dev/null || run npm install -g pm2@6
}

# ---------------------------------------------------------------- 3. user, folders, secrets
prepare_user_and_secrets() {
  say "Creating the service user, folders and secrets"
  id "$RUN_USER" >/dev/null 2>&1 || run useradd --system --create-home --home-dir "$BASE" --shell /bin/bash "$RUN_USER"
  run mkdir -p "$BASE" "$BACKUP_DIR" "$ETC"
  run chown "$RUN_USER:$RUN_USER" "$BASE" "$BACKUP_DIR"

  [[ $DRY_RUN -eq 1 ]] || touch "$FORUM_ENV" "$BRIDGE_ENV"
  [[ -n "$(env_get "$FORUM_ENV" NODEBB_ADMIN_PASSWORD)" ]] || env_set "$FORUM_ENV" NODEBB_ADMIN_PASSWORD "$(rand 12)"
  [[ -n "$(env_get "$FORUM_ENV" DB_PASSWORD)" ]] || env_set "$FORUM_ENV" DB_PASSWORD "$(rand 24)"
  [[ -n "$(env_get "$FORUM_ENV" DB_ADMIN_PASSWORD)" ]] || env_set "$FORUM_ENV" DB_ADMIN_PASSWORD "$(rand 24)"
  [[ -n "$(env_get "$FORUM_ENV" CR_BRIDGE_SECRET)" ]] || env_set "$FORUM_ENV" CR_BRIDGE_SECRET "$(rand 32)"
  for key in CR_DISCORD_CLIENT_ID CR_DISCORD_CLIENT_SECRET; do
    grep -qE "^$key=" "$FORUM_ENV" 2>/dev/null || env_set "$FORUM_ENV" "$key" ""
  done
  env_set "$FORUM_ENV" CR_BRIDGE_URL "http://127.0.0.1:$BRIDGE_PORT"

  if [[ ! -s "$BRIDGE_ENV" && $DRY_RUN -eq 0 ]]; then
    cp "$SRC_DIR/cr-bridge/.env.example" "$BRIDGE_ENV"
  fi
  env_set "$BRIDGE_ENV" CR_BRIDGE_SECRET "$(env_get "$FORUM_ENV" CR_BRIDGE_SECRET)"
  [[ -n "$(env_get "$BRIDGE_ENV" CR_ADMIN_TOKEN)" ]] || env_set "$BRIDGE_ENV" CR_ADMIN_TOKEN "$(rand 24)"
  env_set "$BRIDGE_ENV" CR_BRIDGE_PORT "$BRIDGE_PORT"
  env_set "$BRIDGE_ENV" CR_BRIDGE_DB "$BRIDGE_DIR/data/bridge.db"
  env_set "$BRIDGE_ENV" NODEBB_URL "http://127.0.0.1:$NODEBB_PORT"
  env_set "$BRIDGE_ENV" NODEBB_PUBLIC_URL "$SCHEME://$DOMAIN"

  run chown -R "root:$RUN_USER" "$ETC"
  run chmod 750 "$ETC"
  run chmod 640 "$FORUM_ENV" "$BRIDGE_ENV"
}

# ---------------------------------------------------------------- 4. database
install_database() {
  local dbpass dbadmin
  dbpass="$(env_get "$FORUM_ENV" DB_PASSWORD)"; dbadmin="$(env_get "$FORUM_ENV" DB_ADMIN_PASSWORD)"
  if [[ "$DB_KIND" == mongo ]]; then
    say "Installing MongoDB 8.0"
    if ! command -v mongod >/dev/null; then
      if [[ $DRY_RUN -eq 0 ]]; then
        grep -qw avx /proc/cpuinfo || die "this CPU has no AVX, which MongoDB 5+ needs; re-run with --db redis"
        curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-8.0.gpg
        echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${CODENAME}/mongodb-org/8.0 multiverse" \
          > /etc/apt/sources.list.d/mongodb-org-8.0.list
      fi
      run apt-get update -y
      run apt-get install -y mongodb-org
    fi
    run systemctl enable --now mongod
    if [[ $DRY_RUN -eq 0 ]] && ! grep -q '^security:' /etc/mongod.conf; then
      sleep 3
      # Users first (the localhost exception allows this once), then switch auth on.
      mongosh --quiet admin --eval "db.getUser('admin') || db.createUser({user:'admin', pwd:'$dbadmin', roles:['root']})"
      mongosh --quiet admin --eval "db.getSiblingDB('nodebb').getUser('nodebb') || db.getSiblingDB('nodebb').createUser({user:'nodebb', pwd:'$dbpass', roles:[{role:'readWrite', db:'nodebb'}, {role:'clusterMonitor', db:'admin'}]})"
      printf 'security:\n  authorization: enabled\n' >> /etc/mongod.conf
      sed -i 's/^\(\s*bindIp:\).*/\1 127.0.0.1/' /etc/mongod.conf
      systemctl restart mongod
      sleep 3
    fi
    info "MongoDB listens on 127.0.0.1:27017 with authentication on"
  else
    say "Installing Redis"
    run apt-get install -y redis-server
    if [[ $DRY_RUN -eq 0 ]]; then
      sed -i 's/^#\?\s*bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
      grep -qE '^requirepass ' /etc/redis/redis.conf && sed -i "s/^requirepass .*/requirepass $dbpass/" /etc/redis/redis.conf \
        || echo "requirepass $dbpass" >> /etc/redis/redis.conf
      grep -qE '^appendonly yes' /etc/redis/redis.conf || echo 'appendonly yes' >> /etc/redis/redis.conf
    fi
    run systemctl enable --now redis-server
    run systemctl restart redis-server
  fi
}

# ---------------------------------------------------------------- 5. NodeBB
install_nodebb() {
  say "Installing NodeBB $NODEBB_VERSION on 127.0.0.1:$NODEBB_PORT"
  if [[ ! -d "$NODEBB_DIR/.git" ]]; then
    as_user "$BASE" "git clone --branch '$NODEBB_VERSION' --depth 1 https://github.com/NodeBB/NodeBB.git nodebb"
  else
    as_user "$NODEBB_DIR" "git fetch --depth 1 origin tag '$NODEBB_VERSION' && git -c advice.detachedHead=false checkout '$NODEBB_VERSION'"
  fi
  as_user "$NODEBB_DIR" "[ -f package.json ] || cp install/package.json package.json; npm install --omit=dev --no-audit --no-fund"

  if [[ ! -f "$NODEBB_DIR/config.json" ]]; then
    local dbpass adminpass
    dbpass="$(env_get "$FORUM_ENV" DB_PASSWORD)"; adminpass="$(env_get "$FORUM_ENV" NODEBB_ADMIN_PASSWORD)"
    local dbenv="NODEBB_DB=$DB_KIND NODEBB_DB_HOST=127.0.0.1 NODEBB_DB_PASSWORD='$dbpass'"
    if [[ "$DB_KIND" == mongo ]]; then dbenv+=" NODEBB_DB_PORT=27017 NODEBB_DB_USER=nodebb NODEBB_DB_NAME=nodebb"
    else dbenv+=" NODEBB_DB_PORT=6379 NODEBB_DB_NAME=0"; fi
    as_user "$NODEBB_DIR" "env NODEBB_URL='$SCHEME://$DOMAIN' NODEBB_PORT=$NODEBB_PORT NODEBB_ADMIN_USERNAME=admin \
      NODEBB_ADMIN_PASSWORD='$adminpass' NODEBB_ADMIN_EMAIL='$ADMIN_EMAIL' $dbenv ./nodebb setup"
  fi
  # Listen on localhost only, behind nginx; always port 40006.
  as_user "$NODEBB_DIR" "jq '.port = \"$NODEBB_PORT\" | .bind_address = \"127.0.0.1\" | .trust_proxy = true | .url = \"$SCHEME://$DOMAIN\"' config.json > config.json.new && mv config.json.new config.json && chmod 600 config.json"

  say "Installing the Closet Republic plugin"
  run rsync -a --delete --exclude node_modules "$SRC_DIR/nodebb/plugin/" "$BASE/plugin-src/"
  run chown -R "$RUN_USER:$RUN_USER" "$BASE/plugin-src"
  as_user "$NODEBB_DIR" "npm install --omit=dev --no-audit --no-fund --install-links '$BASE/plugin-src' && ./nodebb activate nodebb-plugin-closet-republic"

  say "Creating the bridge's forum account"
  local uid
  uid="$(env_get "$BRIDGE_ENV" CR_BRIDGE_UID)"
  if [[ -z "$uid" && $DRY_RUN -eq 0 ]]; then
    uid="$(sudo -u "$RUN_USER" -H bash -c "cd '$NODEBB_DIR' && ./nodebb user info --username reddit-bridge 2>/dev/null" | grep -oP "^\s*uid: \K[1-9][0-9]*" | head -1 || true)"
    if [[ -z "$uid" ]]; then
      uid="$(sudo -u "$RUN_USER" -H bash -c "cd '$NODEBB_DIR' && ./nodebb user create reddit-bridge 2>&1" | grep -oP 'with uid: \K\d+' | head -1 || true)"
    fi
    [[ -n "$uid" ]] || die "could not create the reddit-bridge account"
    sudo -u "$RUN_USER" -H bash -c "cd '$NODEBB_DIR' && ./nodebb user make admin $uid" >/dev/null
  fi
  env_set "$BRIDGE_ENV" CR_BRIDGE_UID "${uid:-<uid>}"
  env_set "$FORUM_ENV" CR_BRIDGE_UID "${uid:-<uid>}"

  if [[ -z "$(env_get "$BRIDGE_ENV" NODEBB_TOKEN)" && $DRY_RUN -eq 0 ]]; then
    local token
    install -o "$RUN_USER" -g "$RUN_USER" -m 644 "$SRC_DIR/nodebb/make-api-token.cjs" "$BASE/nodebb-master-token.cjs"
    token="$(sudo -u "$RUN_USER" -H bash -c "cd '$NODEBB_DIR' && node '$BASE/nodebb-master-token.cjs' cr-bridge 2>/dev/null" | tail -1)"
    [[ "$token" =~ ^[0-9a-f-]{36}$ ]] || die "could not create the Write API token; create one in ACP > Settings > API Access and put it in $BRIDGE_ENV as NODEBB_TOKEN"
    env_set "$BRIDGE_ENV" NODEBB_TOKEN "$token"
  fi

  as_user "$NODEBB_DIR" "./nodebb build"
}

# ---------------------------------------------------------------- 6. bridge
install_bridge() {
  say "Installing cr-bridge on 127.0.0.1:$BRIDGE_PORT"
  run mkdir -p "$BRIDGE_DIR/data"
  # config/*.json are only copied the first time, so your edits on the server survive re-runs.
  run rsync -a --exclude node_modules --exclude data --exclude .env --exclude config "$SRC_DIR/cr-bridge/" "$BRIDGE_DIR/"
  [[ -d "$BRIDGE_DIR/config" ]] || run cp -r "$SRC_DIR/cr-bridge/config" "$BRIDGE_DIR/config"
  run chown -R "$RUN_USER:$RUN_USER" "$BRIDGE_DIR"
  as_user "$BRIDGE_DIR" "npm ci --omit=dev --no-audit --no-fund"
}

# ---------------------------------------------------------------- 7. pm2
configure_pm2() {
  say "Registering both processes with pm2 (user $RUN_USER)"
  local eco=$BASE/ecosystem.forum.config.cjs
  if [[ $DRY_RUN -eq 0 ]]; then
    cat > "$eco" <<EOF
// Generated by install-forum.sh. Start/stop as the nodebb user:
//   sudo -u $RUN_USER -H pm2 startOrReload $BASE/ecosystem.forum.config.cjs --update-env
// (re-reads $FORUM_ENV; the bridge reads $BRIDGE_ENV on every start)
const fs = require('fs');
const readEnv = (file) => Object.fromEntries(
  fs.readFileSync(file, 'utf8').split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const forum = readEnv('$FORUM_ENV');
module.exports = {
  apps: [
    {
      name: 'nodebb',
      cwd: '$NODEBB_DIR',
      script: 'loader.js',
      args: '--no-daemon --no-silent',
      env: {
        NODE_ENV: 'production',
        CR_DISCORD_CLIENT_ID: forum.CR_DISCORD_CLIENT_ID,
        CR_DISCORD_CLIENT_SECRET: forum.CR_DISCORD_CLIENT_SECRET,
        CR_BRIDGE_URL: forum.CR_BRIDGE_URL,
        CR_BRIDGE_SECRET: forum.CR_BRIDGE_SECRET,
        CR_BRIDGE_UID: forum.CR_BRIDGE_UID,
        CR_DISCORD_BASE: forum.CR_DISCORD_BASE || '', // only set on test machines (mock Discord)
      },
      max_memory_restart: '1G',
      kill_timeout: 10000,
    },
    {
      name: 'cr-bridge',
      cwd: '$BRIDGE_DIR',
      script: 'src/index.js',
      node_args: '--env-file=$BRIDGE_ENV',
      exec_mode: 'fork',
      instances: 1, // one writer for the SQLite file and the Reddit rate budget
      max_memory_restart: '300M',
      restart_delay: 5000,
    },
  ],
};
EOF
    chown "$RUN_USER:$RUN_USER" "$eco"
  else
    info "+ write $eco"
  fi
  as_user "$BASE" "pm2 startOrReload '$eco' --update-env && pm2 save"
  run env PATH="$PATH" pm2 startup systemd -u "$RUN_USER" --hp "$BASE"
}

# ---------------------------------------------------------------- 8. nginx + TLS
configure_nginx() {
  say "Configuring nginx for $DOMAIN"
  local site=/etc/nginx/sites-available/closet-republic-forum
  if [[ -f "$site" ]]; then
    info "$site already exists; left as it is (delete it and re-run to regenerate)"
  elif [[ $DRY_RUN -eq 0 ]]; then
    cat > "$site" <<EOF
# Closet Republic forum (generated by install-forum.sh)
upstream cr_nodebb { server 127.0.0.1:$NODEBB_PORT; keepalive 16; }
upstream cr_bridge { server 127.0.0.1:$BRIDGE_PORT; }

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 8m;

    # Webhooks only; the bridge's admin and internal routes stay private.
    location /bridge/webhooks/ {
        proxy_pass http://cr_bridge/webhooks/;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://cr_nodebb;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_redirect off;
        proxy_read_timeout 90s;
    }
}
EOF
  else
    info "+ write $site"
  fi
  run ln -sf "$site" /etc/nginx/sites-enabled/closet-republic-forum
  run nginx -t
  run systemctl reload nginx
  if [[ $WITH_TLS -eq 1 ]]; then
    run certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect --keep-until-expiring
  fi
}

# ---------------------------------------------------------------- 9. firewall (opt-in)
configure_firewall() {
  [[ $WITH_FIREWALL -eq 1 ]] || { info "Firewall left as it is (pass --firewall to enable ufw)"; return; }
  say "Enabling ufw (SSH, HTTP, HTTPS only)"
  run ufw allow OpenSSH
  run ufw allow 'Nginx Full'
  run ufw --force enable
}

# ---------------------------------------------------------------- 10. backups
configure_backups() {
  say "Scheduling nightly backups into $BACKUP_DIR (kept 14 days)"
  local script=$BASE/backup-forum.sh
  local dbdump
  if [[ "$DB_KIND" == mongo ]]; then
    dbdump="mongodump --quiet --host 127.0.0.1 --username nodebb --password \"\$(grep ^DB_PASSWORD= $FORUM_ENV | cut -d= -f2-)\" --authenticationDatabase nodebb --db nodebb --archive=\"\$OUT/nodebb.mongo.gz\" --gzip"
  else
    dbdump="redis-cli --no-auth-warning -a \"\$(grep ^DB_PASSWORD= $FORUM_ENV | cut -d= -f2-)\" --rdb \"\$OUT/nodebb.redis.rdb\" >/dev/null"
  fi
  if [[ $DRY_RUN -eq 0 ]]; then
    cat > "$script" <<EOF
#!/usr/bin/env bash
# Nightly forum backup (generated). Copy $BACKUP_DIR off this server too: a backup on the
# same disk does not survive losing the server.
set -euo pipefail
OUT=$BACKUP_DIR/\$(date +%F)
mkdir -p "\$OUT"
$dbdump
tar -czf "\$OUT/uploads.tar.gz" -C $NODEBB_DIR/public uploads
cp $NODEBB_DIR/config.json "\$OUT/config.json"
sqlite3 $BRIDGE_DIR/data/bridge.db ".backup '\$OUT/bridge.db'"
cp -r $BRIDGE_DIR/config "\$OUT/bridge-config"
chmod -R go-rwx "\$OUT"
find $BACKUP_DIR -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
EOF
    chmod 750 "$script"
    echo "15 3 * * * root $script >> /var/log/closet-republic-forum-backup.log 2>&1" > /etc/cron.d/closet-republic-forum
  else
    info "+ write $script and /etc/cron.d/closet-republic-forum"
  fi
}

# ---------------------------------------------------------------- 11. checks + summary
verify() {
  say "Checking that everything answers"
  [[ $DRY_RUN -eq 1 ]] && { info "(skipped in dry run)"; return; }
  sleep 8
  curl -fsS -o /dev/null "http://127.0.0.1:$NODEBB_PORT/" && info "NodeBB answers on 127.0.0.1:$NODEBB_PORT" || info "NodeBB is not answering yet: sudo -u $RUN_USER -H pm2 logs nodebb"
  curl -fsS "http://127.0.0.1:$BRIDGE_PORT/healthz" && echo || info "bridge is not answering yet: sudo -u $RUN_USER -H pm2 logs cr-bridge"
}

summary() {
  say "Done"
  cat <<EOF
    Forum:            $SCHEME://$DOMAIN   (admin user: admin, password in $FORUM_ENV)
    Forum process:    127.0.0.1:$NODEBB_PORT   Bridge: 127.0.0.1:$BRIDGE_PORT
    Secrets:          $FORUM_ENV, $BRIDGE_ENV
    Logs:             sudo -u $RUN_USER -H pm2 logs nodebb    |    sudo -u $RUN_USER -H pm2 logs cr-bridge

    Next (INSTALL.md, Part C):
      C1. Discord login: CR_DISCORD_CLIENT_ID / CR_DISCORD_CLIENT_SECRET in $FORUM_ENV,
          redirect URL $SCHEME://$DOMAIN/auth/discord/callback
      C2. Discord roles: DISCORD_BOT_TOKEN in $BRIDGE_ENV (role ids are already in $BRIDGE_DIR/config/roles.json)
      C3. Buy Me a Coffee: FORUM_BRIDGE_URL / FORUM_BRIDGE_SECRET in the main site's environment
      C4. Reddit: REDDIT_MODE and credentials in $BRIDGE_ENV, category ids in $BRIDGE_DIR/config/sync.json
EOF
}

main() {
  preflight
  install_packages
  prepare_user_and_secrets
  install_database
  install_nodebb
  install_bridge
  configure_pm2
  configure_nginx
  configure_firewall
  configure_backups
  verify
  summary
}

# Sourcing the file (for testing single steps) defines the functions without running them.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main; fi
