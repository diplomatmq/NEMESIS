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

# Create database if it doesn't exist
echo "🗄️ Checking database..."
PGPASSWORD=$POSTGRES_PASSWORD psql -h postgres -U $POSTGRES_USER -tc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'" | grep -q 1 || \
PGPASSWORD=$POSTGRES_PASSWORD psql -h postgres -U $POSTGRES_USER -c "CREATE DATABASE $POSTGRES_DB"
echo "✅ Database ready!"

# Run migrations
echo "📦 Running database migrations..."
node dist/database/migrations/run.js

# Start the bot
echo "🤖 Starting bot..."
exec node dist/index.js
