#!/bin/bash
# Полная перезагрузка всего проекта

set -e

echo "🔄 Полная перезагрузка NEMESIS..."

# Остановить все контейнеры
echo "🛑 Остановка контейнеров..."
docker compose down

# Пересобрать образ бота
echo "🔨 Сборка образа..."
docker compose build --no-cache bot

# Запустить всё заново
echo "🚀 Запуск контейнеров..."
docker compose up -d

# Подождать и показать логи
echo ""
echo "⏳ Ожидание запуска... (15 секунд)"
sleep 15

echo ""
echo "📊 Статус контейнеров:"
docker compose ps

echo ""
echo "📝 Логи бота:"
docker logs --tail 30 nemesis_bot

echo ""
echo "✅ Готово!"
echo ""
echo "Полезные команды:"
echo "  docker logs -f nemesis_bot          # Просмотр логов в реальном времени"
echo "  docker compose ps                   # Статус контейнеров"
echo "  docker exec -it nemesis_postgres psql -U postgres -d nemesis_game  # Подключиться к БД"
