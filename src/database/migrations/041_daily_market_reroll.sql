-- Migration 041: Daily Market free reroll
-- Tracks whether the current day's market has already been rerolled once.

BEGIN;

ALTER TABLE daily_market
    ADD COLUMN IF NOT EXISTS rerolled BOOLEAN NOT NULL DEFAULT false;

COMMIT;
