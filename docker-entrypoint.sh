#!/bin/sh
set -e

echo "🚀 Starting NEMESIS Bot..."

: "${DB_HOST:?DB_HOST must be set}"
: "${DB_PORT:?DB_PORT must be set}"
: "${DB_USER:?DB_USER must be set}"
: "${DB_PASSWORD:?DB_PASSWORD must be set}"
: "${DB_NAME:?DB_NAME must be set}"

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL..."
until nc -z "$DB_HOST" "$DB_PORT"; do
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

# Verify authentication and the target database. Do not treat auth failures as
# a missing database and do not create or modify databases from the bot.
echo "🗄️ Checking database access..."
export PGPASSWORD="$DB_PASSWORD"
psql -v ON_ERROR_STOP=1 \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c 'SELECT 1' >/dev/null
echo "✅ Database access confirmed!"

# Run migrations
echo "📦 Running database migrations..."
node dist/database/migrations/run.js

# Start the bot
echo "🤖 Starting bot..."
exec node dist/index.js
