#!/usr/bin/env sh
# Nightly PostgreSQL backup for the Docker Compose deployment.
#
#   BACKUP_DIR=/var/backups/oceanbrown BACKUP_PASSPHRASE_FILE=/root/.oceanbrown-backup-pass ./scripts/backup.sh
#
# Writes an encrypted custom-format dump, keeps the last $KEEP_DAYS days, and optionally copies it off the
# server with $BACKUP_REMOTE (an rclone remote such as "b2:oceanbrown-backups"). A backup on the same disk
# as the database is not a backup: set BACKUP_REMOTE in production.
#
# Cron (02:30 every night):
#   30 2 * * * cd /opt/whatsapp-chatbot && BACKUP_REMOTE=b2:oceanbrown-backups ./scripts/backup.sh >> /var/log/oceanbrown-backup.log 2>&1
#
# Restore drill (into a scratch database, never the live one):
#   gpg --batch --passphrase-file "$BACKUP_PASSPHRASE_FILE" -d oceanbrown-YYYYmmdd-HHMMSS.dump.gpg > restore.dump
#   docker compose exec -T postgres createdb -U oceanbrown restore_check
#   docker compose exec -T postgres pg_restore -U oceanbrown --no-owner -d restore_check < restore.dump
#   docker compose exec -T postgres psql -U oceanbrown -d restore_check -c 'SELECT count(*) FROM "Message";'
#   docker compose exec -T postgres dropdb -U oceanbrown restore_check
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/oceanbrown}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PASSFILE="${BACKUP_PASSPHRASE_FILE:-}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/oceanbrown-$STAMP.dump"

if [ -z "$PASSFILE" ] || [ ! -r "$PASSFILE" ]; then
  echo "Set BACKUP_PASSPHRASE_FILE to a readable file holding the encryption passphrase" >&2
  exit 1
fi
command -v gpg >/dev/null 2>&1 || { echo "gpg is required" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077

docker compose exec -T postgres pg_dump -U oceanbrown --format=custom oceanbrown > "$OUT"
# A truncated dump is worse than none: make sure pg_restore can read its table of contents.
docker compose exec -T postgres pg_restore --list < "$OUT" > /dev/null

gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$PASSFILE" -o "$OUT.gpg" "$OUT"
rm -f "$OUT"
echo "$(date -u +%FT%TZ) backup written: $OUT.gpg ($(wc -c < "$OUT.gpg") bytes)"

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone copy "$OUT.gpg" "$BACKUP_REMOTE/" && echo "copied to $BACKUP_REMOTE"
else
  echo "WARNING: BACKUP_REMOTE is not set; this backup only exists on this server" >&2
fi

find "$BACKUP_DIR" -name 'oceanbrown-*.dump.gpg' -mtime +"$KEEP_DAYS" -delete
