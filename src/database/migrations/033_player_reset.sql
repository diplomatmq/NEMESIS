-- Migration 033: track the once-per-season player reset.
--
-- A player may wipe their own progress with /reset exactly once per season.
-- The flag lives on player_progress, which is unique per (user_id, season_id),
-- so a new season automatically grants a fresh reset.

BEGIN;

ALTER TABLE player_progress
  ADD COLUMN IF NOT EXISTS reset_used BOOLEAN NOT NULL DEFAULT false;

COMMIT;
