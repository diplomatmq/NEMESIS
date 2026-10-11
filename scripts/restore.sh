#!/bin/bash

###############################################################################
# NEMESIS Database Restore Script
# 
# Восстанавливает базу данных из резервной копии.
#
# ВНИМАНИЕ: Этот скрипт НЕ удаляет существующую базу данных!
# Он только добавляет данные из бэкапа. Если нужно полностью
# пересоздать базу, используйте опцию --drop-database.
#
# Использование:
#   ./scripts/restore.sh <backup_file>
#   ./scripts/restore.sh --drop-database <backup_file>
#
# Примеры:
#   ./scripts/restore.sh backups/nemesis_backup_20240315_120000.sql.gz
#   ./scripts/restore.sh --drop-database backups/nemesis_backup_20240315_120000.sql.gz
###############################################################################

set -e

# Определяем директории
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Опции
DROP_DATABASE=false

# Парсим аргументы
while [[ $# -gt 0 ]]; do
    case $1 in
        --drop-database)
            DROP_DATABASE=true
            shift
            ;;
        *)
            BACKUP_FILE="$1"
            shift
            ;;
    esac
done

# Проверяем, что указан файл бэкапа
if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: $0 [--drop-database] <backup_file>"
    echo ""
    echo "Available backups:"
    ls -lh "$PROJECT_DIR/backups"/nemesis_backup_*.sql.gz 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
    exit 1
fi

# Проверяем, что файл существует
if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "=================================="
echo "NEMESIS Database Restore"
echo "=================================="
echo "Started at: $(date)"
echo ""

# Проверяем, что контейнер PostgreSQL запущен
if ! docker ps | grep -q nemesis_postgres; then
    echo "❌ ERROR: PostgreSQL container 'nemesis_postgres' is not running!"
    echo "   Start it with: docker compose up -d postgres"
    exit 1
fi

echo "📋 Restore configuration:"
echo "   Source: $BACKUP_FILE"
echo "   Drop database: $DROP_DATABASE"
echo ""

# Останавливаем бота если он запущен
if docker ps | grep -q nemesis_bot; then
    echo "🛑 Stopping bot container..."
    docker compose stop bot
    echo "   Bot stopped"
    echo ""
fi

# Удаляем и пересоздаём базу если указана опция
if [ "$DROP_DATABASE" = true ]; then
    echo "⚠️  WARNING: This will DROP and recreate the database!"
    echo "   All current data will be LOST!"
    echo ""
    read -p "Are you sure? Type 'yes' to continue: " CONFIRM
    
    if [ "$CONFIRM" != "yes" ]; then
        echo "❌ Restore cancelled"
        exit 1
    fi
    
    echo ""
    echo "🗑️  Dropping database..."
    docker exec nemesis_postgres psql -U postgres -c "DROP DATABASE IF EXISTS nemesis_game;"
    
    echo "📦 Creating new database..."
    docker exec nemesis_postgres psql -U postgres -c "CREATE DATABASE nemesis_game OWNER postgres;"
    echo ""
fi

# Восстанавливаем из бэкапа
echo "📥 Restoring from backup..."

if echo "$BACKUP_FILE" | grep -q ".gz$"; then
    # Сжатый бэкап
    gunzip -c "$BACKUP_FILE" | docker exec -i nemesis_postgres psql -U postgres nemesis_game
else
    # Несжатый бэкап
    docker exec -i nemesis_postgres psql -U postgres nemesis_game < "$BACKUP_FILE"
fi

echo "✅ Database restored successfully!"
echo ""

# Проверяем состояние базы
echo "🔍 Verifying database..."
docker exec nemesis_postgres psql -U postgres -d nemesis_game -c "
    SELECT 
        (SELECT COUNT(*) FROM users) as users_count,
        (SELECT COUNT(*) FROM player_progress) as progress_count,
        (SELECT COUNT(*) FROM items) as items_count;
"

echo ""
echo "🚀 Starting bot..."
docker compose start bot

echo ""
echo "✅ Restore completed successfully!"
echo "Finished at: $(date)"
echo "=================================="
