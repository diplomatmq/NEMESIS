-- Migration 034: collectible boss pins.
--
-- Defeating a named boss permanently grants its custom emoji as a "pin".
-- The player may equip one pin, which is shown next to their name in /top.
-- Pins live on player_progress (unique per user/season), so a new season
-- starts a fresh collection.

BEGIN;

ALTER TABLE player_progress
  ADD COLUMN IF NOT EXISTS boss_pins JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS active_pin JSONB;

COMMIT;
