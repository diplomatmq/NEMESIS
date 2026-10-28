-- Manual seasonal tournaments.
--
-- `total_wins` / `total_deaths` accumulate every cleared floor and every loss
-- so the per-class winrate of a finished season can be derived without
-- scanning the combat log.
ALTER TABLE player_progress
  ADD COLUMN IF NOT EXISTS total_wins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_deaths INTEGER NOT NULL DEFAULT 0;

-- Marks a season whose end-of-season report has already been broadcast, so the
-- announcement is sent exactly once.
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS is_finished BOOLEAN NOT NULL DEFAULT false;

-- The automatically created season that predates the first manual /sstart is a
-- test season and must never be reported as a finished tournament. Renumber it
-- to 0 while keeping its data intact.
UPDATE seasons
  SET season_number = 0
  WHERE is_active = true
    AND season_number = 1
    AND NOT EXISTS (SELECT 1 FROM seasons s WHERE s.season_number = 0);
