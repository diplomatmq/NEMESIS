-- Migration 038: bosses weaken after each defeat of the player.
--
-- boss_fail_floor  — the boss floor the player last died to
-- boss_fail_stacks — how many times in a row the player lost to that boss.
-- Each stack shaves 5% off the boss HP, attack and defence on the next attempt.
-- Both fields are cleared as soon as the boss is finally killed.

BEGIN;

ALTER TABLE player_progress
  ADD COLUMN IF NOT EXISTS boss_fail_floor INTEGER,
  ADD COLUMN IF NOT EXISTS boss_fail_stacks INTEGER NOT NULL DEFAULT 0;

COMMIT;
