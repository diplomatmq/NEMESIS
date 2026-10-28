-- Migration 037: Halve the level requirement of every item

BEGIN;

UPDATE items
SET level_required = GREATEST(1, FLOOR(level_required / 2.0)::INTEGER)
WHERE level_required > 1;

COMMIT;
