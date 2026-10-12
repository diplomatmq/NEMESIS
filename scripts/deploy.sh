#!/bin/bash
# Скрипт для деплоя на продакшен сервере

set -e

echo "🚀 Деплой NEMESIS бота..."

# Остановить старые контейнеры
echo "📦 Остановка старых контейнеров..."
docker compose down

# Собрать новый образ
echo "🔨 Сборка Docker образа..."
docker compose build bot

# Запустить сервисы
echo "🐳 Запуск сервисов..."
docker compose up -d postgres redis

# Подождать готовности базы данных
echo "⏳ Ожидание запуска PostgreSQL (30 секунд)..."
sleep 30

# Запустить миграции внутри временного контейнера
echo "🔄 Запуск миграций..."
docker compose run --rm bot npm run migrate

# Запустить бота
echo "🤖 Запуск бота..."
docker compose up -d bot

# Показать статус
echo ""
echo "✅ Деплой завершён!"
echo ""
echo "📊 Проверка статуса:"
docker compose ps

echo ""
echo "📝 Полезные команды:"
echo "  docker logs -f nemesis_bot      # Просмотр логов"
echo "  docker compose ps               # Статус контейнеров"
echo "  docker compose down             # Остановка всех контейнеров"
echo "  docker compose restart bot      # Перезапуск бота"
