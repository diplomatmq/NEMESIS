#!/bin/bash

# Development startup script for NEMESIS Tower Game
# Starts PostgreSQL, Redis, Bot, and MiniApp in development mode

echo "🚀 Starting NEMESIS Tower Game (Development Mode)..."

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "❌ Error: .env.local not found!"
    echo "📝 Please create .env.local from .env.example:"
    echo "   cp .env.example .env.local"
    echo "   # Edit .env.local with your settings"
    exit 1
fi

# Load environment variables
export $(grep -v '^#' .env.local | xargs)

echo "✅ Environment variables loaded"

# Check if PostgreSQL is running
if ! pg_isready -h ${DB_HOST:-localhost} -p ${DB_PORT:-5432} > /dev/null 2>&1; then
    echo "❌ PostgreSQL is not running on ${DB_HOST:-localhost}:${DB_PORT:-5432}"
    echo "📝 Please start PostgreSQL first"
    exit 1
fi

echo "✅ PostgreSQL is running"

# Check if Redis is running
if ! redis-cli -h ${REDIS_HOST:-localhost} -p ${REDIS_PORT:-6379} ping > /dev/null 2>&1; then
    echo "❌ Redis is not running on ${REDIS_HOST:-localhost}:${REDIS_PORT:-6379}"
    echo "📝 Please start Redis first"
    exit 1
fi

echo "✅ Redis is running"

# Install Node.js dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing Node.js dependencies..."
    npm install
fi

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Run migrations
echo "🗃️ Running database migrations..."
npm run migrate

# Start the bot in development mode
echo "🤖 Starting Telegram bot..."
npm run dev &
BOT_PID=$!

# Start the mini app if configured
if [ ! -z "$WEBAPP_URL" ]; then
    echo "🎮 Starting Mini App..."
    cd app/ebashnya/app
    python3 server.py &
    MINIAPP_PID=$!
    cd ../../..
    echo "✅ Mini App started on port ${PORT:-8080}"
else
    echo "⚠️ WEBAPP_URL not set, skipping Mini App"
fi

echo ""
echo "✅ NEMESIS Tower Game is running!"
echo ""
echo "📊 Services:"
echo "   🤖 Bot: Running (PID: $BOT_PID)"
if [ ! -z "$MINIAPP_PID" ]; then
    echo "   🎮 Mini App: Running on port ${PORT:-8080} (PID: $MINIAPP_PID)"
fi
echo ""
echo "🛑 To stop all services, press Ctrl+C"
echo ""

# Wait for Ctrl+C
trap "echo ''; echo '🛑 Stopping services...'; kill $BOT_PID 2>/dev/null; [ ! -z '$MINIAPP_PID' ] && kill $MINIAPP_PID 2>/dev/null; echo '✅ All services stopped'; exit 0" INT

wait
