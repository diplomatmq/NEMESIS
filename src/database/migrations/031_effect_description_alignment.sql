-- Migration 031: align the remaining item description with its implemented effect.
--
-- 'eight_fates' is implemented in SpecialEffects as a flat +5% damage bonus
-- (the same as the other flat-damage relics), not as the one-time defensive
-- boost the original text promised. The description is corrected so it can
-- never mislead the player, following the convention set by migration 030.

BEGIN;

UPDATE items SET description = '+50 ATK, +50 DEF, +250 HP, +5% урона'
WHERE name = 'Печать восьми судеб' AND slot = 'accessory';

COMMIT;
