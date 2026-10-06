# Multi-stage build for NEMESIS Tower Game Bot

# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Copy SQL migration files to dist (TypeScript doesn't copy .sql files)
RUN mkdir -p dist/database/migrations && \
    cp src/database/migrations/*.sql dist/database/migrations/

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app

# Install netcat for health checks and wait script
RUN apk add --no-cache netcat-openbsd

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port (if using webhook)
EXPOSE 3000

# Start the bot with entrypoint
ENTRYPOINT ["docker-entrypoint.sh"]
