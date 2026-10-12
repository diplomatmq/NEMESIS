#!/bin/bash
# Быстрое обновление бота без полного пересоздания

set -e

echo "🔄 Обновление бота..."

# Пересобрать образ бота
echo "🔨 Сборка нового образа..."
docker compose build bot

# Остановить и удалить только контейнер бота
echo "🛑 Остановка старого бота..."
docker compose stop bot
docker compose rm -f bot

# Запустить миграции (если есть новые)
echo "🔄 Проверка миграций..."
docker compose run --rm bot npm run migrate

# Запустить нового бота
echo "🤖 Запуск обновлённого бота..."
docker compose up -d bot

# Показать логи
echo ""
echo "✅ Бот обновлён!"
echo "📊 Логи последних 20 строк:"
docker logs --tail 20 nemesis_bot

echo ""
echo "Для просмотра полных логов: docker logs -f nemesis_bot"
