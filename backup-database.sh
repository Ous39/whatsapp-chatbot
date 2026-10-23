#!/bin/bash
BACKUP_DIR="/opt/whatsapp-chatbot/backups"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/oceanbrown_$TIMESTAMP.sql"

docker compose exec -T postgres pg_dump -U oceanbrown oceanbrown | gzip > $BACKUP_FILE
echo "Backup saved: $BACKUP_FILE"

# Keep only last 7 backups
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
