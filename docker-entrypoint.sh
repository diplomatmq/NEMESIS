#!/bin/sh
set -e

echo "🚀 Starting NEMESIS Bot..."

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL..."
until nc -z postgres 5432; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 2
done
echo "✅ PostgreSQL is ready!"

# Wait for Redis to be ready
echo "⏳ Waiting for Redis..."
until nc -z redis 6379; do
  echo "Redis is unavailable - sleeping"
  sleep 2
done
echo "✅ Redis is ready!"

# Run migrations
echo "📦 Running database migrations..."
node dist/database/migrations/run.js

# Start the bot
echo "🤖 Starting bot..."
exec node dist/index.js
