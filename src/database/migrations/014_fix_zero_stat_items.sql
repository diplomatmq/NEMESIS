-- Fix items with zero stats - add BALANCED base stats to class exclusive items
-- These are legendary items, so they should be good but not overpowered
UPDATE items
SET 
  hp_bonus = 300,
  attack_bonus = 30,
  defense_bonus = 15
WHERE item_type = 'class_exclusive'
  AND hp_bonus = 0
  AND attack_bonus = 0
  AND defense_bonus = 0;

-- Ensure all items have at least some stats or special effect
UPDATE items
SET special_effect = 'unique'
WHERE 
  hp_bonus = 0 
  AND attack_bonus = 0 
  AND defense_bonus = 0
  AND crit_chance_bonus = 0
  AND dodge_bonus = 0
  AND lifesteal_bonus = 0
  AND ai_resist_bonus = 0
  AND (special_effect IS NULL OR special_effect = '');

COMMENT ON COLUMN items.special_effect IS 'Special effect or ability of the item';
