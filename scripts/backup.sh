#!/bin/bash

###############################################################################
# NEMESIS Database Backup Script
# 
# Создаёт резервную копию базы данных PostgreSQL и сохраняет её
# в каталог backups/ с timestep в имени файла.
#
# Автоматически удаляет бэкапы старше 7 дней.
#
# Использование:
#   ./scripts/backup.sh
#
# Добавить в crontab для автоматических бэкапов:
#   0 3 * * * /opt/bots/NEMESIS/scripts/backup.sh >> /opt/bots/NEMESIS/logs/backup.log 2>&1
###############################################################################

set -e

# Определяем директории
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
LOG_DIR="$PROJECT_DIR/logs"

# Создаём директории если не существуют
mkdir -p "$BACKUP_DIR"
mkdir -p "$LOG_DIR"

# Имя файла бэкапа с timestep
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/nemesis_backup_$TIMESTAMP.sql.gz"

# Параметры для удаления старых бэкапов (дней)
RETENTION_DAYS=7

echo "=================================="
echo "NEMESIS Database Backup"
echo "=================================="
echo "Started at: $(date)"
echo ""

# Проверяем, что контейнер PostgreSQL запущен
if ! docker ps | grep -q nemesis_postgres; then
    echo "❌ ERROR: PostgreSQL container 'nemesis_postgres' is not running!"
    echo "   Start it with: docker compose up -d postgres"
    exit 1
fi

echo "📦 Creating backup..."
echo "   Source: nemesis_postgres container"
echo "   Database: nemesis_game"
echo "   Destination: $BACKUP_FILE"
echo ""

# Создаём бэкап
if docker exec nemesis_postgres pg_dump -U postgres nemesis_game | gzip > "$BACKUP_FILE"; then
    # Получаем размер файла
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    
    echo "✅ Backup created successfully!"
    echo "   File: $BACKUP_FILE"
    echo "   Size: $BACKUP_SIZE"
else
    echo "❌ ERROR: Backup failed!"
    exit 1
fi

echo ""
echo "🧹 Cleaning old backups (older than $RETENTION_DAYS days)..."

# Удаляем старые бэкапы
DELETED_COUNT=$(find "$BACKUP_DIR" -name "nemesis_backup_*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete -print | wc -l)

if [ "$DELETED_COUNT" -gt 0 ]; then
    echo "   Deleted $DELETED_COUNT old backup(s)"
else
    echo "   No old backups to delete"
fi

echo ""
echo "📊 Current backups:"
ls -lh "$BACKUP_DIR"/nemesis_backup_*.sql.gz 2>/dev/null | awk '{print "   " $9 " (" $5 ")"}'

echo ""
echo "✅ Backup completed successfully!"
echo "Finished at: $(date)"
echo "=================================="
