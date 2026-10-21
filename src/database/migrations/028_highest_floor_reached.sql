-- Migration 028: persistent highest unlocked floor.
-- Level and equipment requirements must never drop when the player dies and
-- is sent back to a checkpoint, so the maximum reached floor is stored
-- separately from the current position.

BEGIN;

ALTER TABLE player_progress
  ADD COLUMN IF NOT EXISTS highest_floor_reached INTEGER NOT NULL DEFAULT 1;

-- Backfill from the greatest floor ever reached: current position plus the
-- per-chat historical maximum (chat_progress.highest_floor_reached never drops).
UPDATE player_progress pp
SET highest_floor_reached = GREATEST(
  pp.floor,
  COALESCE((
    SELECT MAX(cp.highest_floor_reached)
    FROM chat_progress cp
    WHERE cp.user_id = pp.user_id AND cp.season_id = pp.season_id
  ), 1),
  1
);

-- Recompute level from the persistent maximum so it never decreases on death.
UPDATE player_progress
SET level = (highest_floor_reached - 1) / 10 + 1;

COMMIT;
