-- Migration 032: vampire sustain nerf for existing databases.
--
-- The vampire sustain was reduced across three sources:
--   * class lifesteal 18% -> 15%  (ClassService.getClassLifesteal)
--   * Клинок вампира lifesteal_bonus 7 -> 5  (this migration)
--   * Броня крови attack_regeneration 2% -> 1% of max HP (SpecialEffects)
-- Only the weapon value is stored in the database; the class constant and the
-- armor regeneration factor live in code. The description is refreshed so the
-- displayed bonus matches the applied one.

BEGIN;

UPDATE items
SET lifesteal_bonus = 5,
    description = REPLACE(description, '+7% lifesteal', '+5% lifesteal')
WHERE name = 'Клинок вампира'
  AND slot = 'weapon';

COMMIT;
