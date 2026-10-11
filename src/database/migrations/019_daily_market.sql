-- Migration 019: Daily Market System
-- Creates a daily rotating market with limited items

BEGIN;

-- Table to store daily market state
CREATE TABLE IF NOT EXISTS daily_market (
    id SERIAL PRIMARY KEY,
    market_date DATE NOT NULL UNIQUE,
    items_json JSONB NOT NULL, -- Array of {item_id, price, discount}
    seed INTEGER NOT NULL, -- Random seed for reproducibility
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_daily_market_date ON daily_market(market_date DESC);

COMMIT;
