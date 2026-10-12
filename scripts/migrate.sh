#!/bin/bash
# Скрипт для запуска миграций на сервере

set -e

echo "🔄 Запуск миграций базы данных..."

# Проверить что контейнеры запущены
if ! docker ps | grep -q nemesis_postgres; then
    echo "❌ PostgreSQL не запущен!"
    echo "Запустите: docker compose up -d postgres redis"
    exit 1
fi

# Запустить миграции через временный контейнер бота
docker compose run --rm bot npm run migrate

echo ""
echo "✅ Миграции выполнены успешно!"
