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
MAX_RETRIES=30
RETRY_COUNT=0
until nc -z "$DB_HOST" "$DB_PORT"; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "❌ PostgreSQL is not available after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "PostgreSQL is unavailable - sleeping (attempt $RETRY_COUNT/$MAX_RETRIES)"
  sleep 2
done
echo "✅ PostgreSQL is ready!"

# Wait for Redis to be ready
echo "⏳ Waiting for Redis..."
RETRY_COUNT=0
until nc -z redis 6379; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "❌ Redis is not available after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "Redis is unavailable - sleeping (attempt $RETRY_COUNT/$MAX_RETRIES)"
  sleep 2
done
echo "✅ Redis is ready!"

# Set PostgreSQL password for psql commands
export PGPASSWORD="$DB_PASSWORD"

# Check if database exists, create if it doesn't
echo "🗄️ Checking if database '$DB_NAME' exists..."
DB_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo "")

if [ -z "$DB_EXISTS" ]; then
  echo "📦 Database '$DB_NAME' does not exist. Creating..."
  
  # Create database
  psql -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
    -c "CREATE DATABASE $DB_NAME OWNER $DB_USER ENCODING 'UTF8' LC_COLLATE='en_US.utf8' LC_CTYPE='en_US.utf8' TEMPLATE template0;"
  
  if [ $? -eq 0 ]; then
    echo "✅ Database '$DB_NAME' created successfully!"
  else
    echo "❌ Failed to create database '$DB_NAME'"
    exit 1
  fi
else
  echo "✅ Database '$DB_NAME' already exists"
fi

# Verify database connection
echo "🔌 Testing connection to database '$DB_NAME'..."
psql -v ON_ERROR_STOP=1 \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c 'SELECT current_database(), current_user, version();' >/dev/null

if [ $? -eq 0 ]; then
  echo "✅ Database connection confirmed!"
else
  echo "❌ Failed to connect to database '$DB_NAME'"
  exit 1
fi

# Run migrations
echo "📦 Running database migrations..."
node dist/database/migrations/run.js

if [ $? -ne 0 ]; then
  echo "❌ Database migrations failed!"
  exit 1
fi

echo "✅ Database is ready!"

# Start the bot
echo "🤖 Starting bot..."
exec node dist/index.js
