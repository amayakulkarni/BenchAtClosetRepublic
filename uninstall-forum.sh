#!/usr/bin/env bash
# Closet Republic forum: removes what install-forum.sh added.
#
# Removes:
#   the forum and bridge processes (pm2 under the "nodebb" user) and their boot service
#   the nginx site and its Let's Encrypt certificate
#   the nightly backup job
#   the forum's database and database user (MongoDB "nodebb" database, or Redis database 0)
#   /opt/closet-republic, /etc/closet-republic and the "nodebb" system user
# Keeps:
#   the backups: moved to /var/backups/closet-republic-forum (unless --delete-backups)
#   Node.js, nginx, certbot, MongoDB/Redis themselves (unless --remove-packages)
#   firewall rules, and everything that belongs to the main site (ports 40001-40005)
#
# Usage (as root):
#   sudo ./uninstall-forum.sh --dry-run        print every step, change nothing
#   sudo ./uninstall-forum.sh                  remove the forum (asks for confirmation)
# Options:
#   --keep-data          stop and unregister the forum, but keep its files, secrets and database
#                        (re-running install-forum.sh brings it back as it was)
#   --delete-backups     delete the backups too instead of moving them
#   --remove-packages    also purge MongoDB or Redis (only when nothing else on the server uses it)
#   --yes                skip the confirmation question
#   --dry-run            print what would happen, change nothing
set -euo pipefail

BASE=/opt/closet-republic
NODEBB_DIR=$BASE/nodebb
BACKUP_DIR=$BASE/backups
ETC=/etc/closet-republic
FORUM_ENV=$ETC/forum.env
RUN_USER=nodebb
SITE=closet-republic-forum
KEEP_BACKUPS_IN=/var/backups/closet-republic-forum

KEEP_DATA=0
DELETE_BACKUPS=0
REMOVE_PACKAGES=0
ASSUME_YES=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-data) KEEP_DATA=1; shift ;;
    --delete-backups) DELETE_BACKUPS=1; shift ;;
    --remove-packages) REMOVE_PACKAGES=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
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
# Same as run, but a failure is reported and the uninstall carries on.
try()  { run "$@" || info "(skipped: '$*' failed)"; }
env_get() { [[ -r "$1" ]] && grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- || true; }
has_user() { id "$RUN_USER" >/dev/null 2>&1; }

# ---------------------------------------------------------------- 1. checks
preflight() {
  say "Checking what is installed"
  [[ $EUID -eq 0 || $DRY_RUN -eq 1 ]] || die "run as root (sudo)"

  DB_KIND=""
  if [[ -r "$NODEBB_DIR/config.json" ]] && command -v jq >/dev/null; then
    DB_KIND="$(jq -r '.database // empty' "$NODEBB_DIR/config.json")"
  fi
  DOMAIN=""
  if [[ -r /etc/nginx/sites-available/$SITE ]]; then
    DOMAIN="$(awk '/server_name/ {gsub(";", "", $2); print $2; exit}' /etc/nginx/sites-available/$SITE)"
  fi

  [[ -d "$BASE" || -d "$ETC" || -e /etc/nginx/sites-available/$SITE ]] || has_user \
    || { info "Nothing from install-forum.sh was found. Nothing to do."; exit 0; }

  info "Forum folder:  $([[ -d $BASE ]] && echo "$BASE" || echo "not found")"
  info "Secrets:       $([[ -d $ETC ]] && echo "$ETC" || echo "not found")"
  info "Database:      ${DB_KIND:-unknown}"
  info "Domain:        ${DOMAIN:-unknown}"
  info "Mode:          $([[ $KEEP_DATA -eq 1 ]] && echo "stop only, keep data" || echo "full removal")"

  if [[ $DRY_RUN -eq 0 && $ASSUME_YES -eq 0 ]]; then
    local answer
    printf '\nType "uninstall" to continue: '
    read -r answer
    [[ "$answer" == uninstall ]] || die "cancelled, nothing was changed"
  fi
}

# ---------------------------------------------------------------- 2. processes
stop_processes() {
  say "Stopping the forum and the bridge"
  if has_user && sudo -u "$RUN_USER" -H bash -c 'command -v pm2' >/dev/null 2>&1; then
    try sudo -u "$RUN_USER" -H pm2 delete nodebb
    try sudo -u "$RUN_USER" -H pm2 delete cr-bridge
    try sudo -u "$RUN_USER" -H pm2 save --force
    [[ $KEEP_DATA -eq 1 ]] || try sudo -u "$RUN_USER" -H pm2 kill
  else
    info "pm2 for $RUN_USER not found (already stopped)"
  fi
  # NodeBB saves its counters while shutting down, so wait for every process to exit before
  # the database is emptied.
  if [[ $KEEP_DATA -eq 0 ]] && has_user; then
    if [[ $DRY_RUN -eq 1 ]]; then
      info "+ stop every remaining process of $RUN_USER and wait for it to exit"
    else
      pkill -u "$RUN_USER" 2>/dev/null || true
      for _ in $(seq 1 20); do pgrep -u "$RUN_USER" >/dev/null || break; sleep 1; done
      pkill -KILL -u "$RUN_USER" 2>/dev/null || true
      sleep 1
    fi
  fi
  if [[ -f /etc/systemd/system/pm2-$RUN_USER.service ]]; then
    try systemctl disable --now "pm2-$RUN_USER"
    run rm -f "/etc/systemd/system/pm2-$RUN_USER.service"
    try systemctl daemon-reload
  fi
}

# ---------------------------------------------------------------- 3. nginx + certificate
remove_nginx() {
  say "Removing the nginx site"
  run rm -f "/etc/nginx/sites-enabled/$SITE" "/etc/nginx/sites-available/$SITE"
  if command -v nginx >/dev/null; then
    if [[ $DRY_RUN -eq 1 ]] || nginx -t >/dev/null 2>&1; then
      try systemctl reload nginx
    else
      info "WARNING: nginx -t reports an error in another site; nginx was not reloaded"
    fi
  fi
  if [[ $KEEP_DATA -eq 0 && -n "$DOMAIN" && "$DOMAIN" != localhost && -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
    try certbot delete --cert-name "$DOMAIN" --non-interactive
  fi
}

# ---------------------------------------------------------------- 4. backup job
remove_backup_job() {
  say "Removing the nightly backup job"
  run rm -f /etc/cron.d/closet-republic-forum
}

# ---------------------------------------------------------------- 5. database
remove_database() {
  local dbadmin
  dbadmin="$(env_get "$FORUM_ENV" DB_ADMIN_PASSWORD)"
  case "$DB_KIND" in
    mongo)
      say "Removing the MongoDB database \"nodebb\" and its users"
      if command -v mongosh >/dev/null && [[ -n "$dbadmin" ]]; then
        # The password is read inside the command so a dry run never prints it.
        try bash -c "mongosh --quiet -u admin -p \"\$(grep ^DB_ADMIN_PASSWORD= $FORUM_ENV | cut -d= -f2-)\" --authenticationDatabase admin --eval \"const n = db.getSiblingDB('nodebb'); n.dropDatabase(); if (n.getUser('nodebb')) n.dropUser('nodebb');\""
      else
        info "mongosh or the admin password is missing; database left as it is"
      fi
      if [[ $REMOVE_PACKAGES -eq 1 ]]; then
        try systemctl disable --now mongod
        try env DEBIAN_FRONTEND=noninteractive apt-get purge -y 'mongodb-org*'
        run rm -rf /var/lib/mongodb /var/log/mongodb /etc/apt/sources.list.d/mongodb-org-8.0.list /usr/share/keyrings/mongodb-server-8.0.gpg
      else
        info "MongoDB itself stays installed (its admin user and authentication setting are kept)"
      fi
      ;;
    redis)
      say "Emptying Redis database 0 and removing the forum's Redis password"
      if command -v redis-cli >/dev/null; then
        try bash -c "REDISCLI_AUTH=\"\$(grep ^DB_PASSWORD= $FORUM_ENV | cut -d= -f2-)\" redis-cli -n 0 FLUSHDB"
      fi
      if [[ $REMOVE_PACKAGES -eq 1 ]]; then
        try systemctl disable --now redis-server
        try env DEBIAN_FRONTEND=noninteractive apt-get purge -y redis-server redis-tools
        run rm -rf /var/lib/redis
      elif [[ -f /etc/redis/redis.conf ]]; then
        run sed -i '/^requirepass /d' /etc/redis/redis.conf
        try systemctl restart redis-server
      fi
      ;;
    *)
      info "Database type unknown (no $NODEBB_DIR/config.json); database left as it is"
      ;;
  esac
}

# ---------------------------------------------------------------- 6. files and user
remove_files() {
  if [[ -d "$BACKUP_DIR" ]]; then
    if [[ $DELETE_BACKUPS -eq 1 ]]; then
      say "Deleting the backups"
    else
      say "Moving the backups to $KEEP_BACKUPS_IN"
      run mkdir -p "$KEEP_BACKUPS_IN"
      run cp -a "$BACKUP_DIR/." "$KEEP_BACKUPS_IN/"
      run chown -R root:root "$KEEP_BACKUPS_IN"
      run chmod 700 "$KEEP_BACKUPS_IN"
    fi
  fi

  say "Deleting the forum files, secrets and service user"
  run rm -rf "$BASE" "$ETC"
  run rm -f /var/log/closet-republic-forum-backup.log
  if has_user; then
    try userdel "$RUN_USER"
  fi
}

# ---------------------------------------------------------------- 7. summary
summary() {
  say "Done"
  if [[ $KEEP_DATA -eq 1 ]]; then
    info "The forum is stopped and no longer starts at boot or answers through nginx."
    info "Files, secrets and the database are kept in $BASE, $ETC and the database."
    info "Bring it back: sudo ./install-forum.sh --domain <domain> --email <email> (same options as before)."
  else
    info "The forum, bridge, database, secrets and service user are removed."
    [[ $DELETE_BACKUPS -eq 1 ]] || info "Backups kept in $KEEP_BACKUPS_IN"
    [[ $REMOVE_PACKAGES -eq 1 ]] || info "Node.js, nginx, certbot and ${DB_KIND:-the database server} are still installed."
  fi
  info "On the main site, remove COMMUNITY_FORUM_URL and FORUM_BRIDGE_URL / FORUM_BRIDGE_SECRET from its"
  info "environment and restart it, so it stops linking to the forum and forwarding Buy Me a Coffee events."
}

main() {
  preflight
  stop_processes
  remove_nginx
  remove_backup_job
  if [[ $KEEP_DATA -eq 0 ]]; then
    remove_database
    remove_files
  fi
  summary
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main; fi
