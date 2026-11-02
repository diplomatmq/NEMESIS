-- Migration 042: Per-user daily market
-- Each Telegram user gets their own daily market. The old global market was
-- keyed by market_date only; it is replaced with a (market_date, user_id) key.

BEGIN;

ALTER TABLE daily_market
    ADD COLUMN IF NOT EXISTS user_id BIGINT;

-- Drop the old global unique constraint / index on market_date.
ALTER TABLE daily_market DROP CONSTRAINT IF EXISTS daily_market_market_date_key;
DROP INDEX IF EXISTS idx_daily_market_date;

-- Remove the obsolete global rows that belong to nobody.
DELETE FROM daily_market WHERE user_id IS NULL;

-- One market per user per day.
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_market_date_user
    ON daily_market(market_date, user_id);

COMMIT;
