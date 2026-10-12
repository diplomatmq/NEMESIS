#!/bin/bash
# Скрипт для очистки лишних баз данных

set -e

echo "🧹 Очистка лишних баз данных..."

# Удалить readme_to_recover (это какая-то левая БД)
docker exec -it nemesis_postgres psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS readme_to_recover;"

echo "✅ Лишние базы данных удалены!"

# Показать список оставшихся БД
echo ""
echo "📋 Текущие базы данных:"
docker exec -it nemesis_postgres psql -U postgres -d postgres -c '\l'
