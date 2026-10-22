-- Migration 030: guarantee class synergy metadata and refresh effect descriptions.
--
-- Migration 022 inserts items together with their affinity rows, but this runs
-- again idempotently to cover databases where that insert was skipped. The
-- ON CONFLICT clause keeps the bonuses unique, so no bonus is duplicated.

BEGIN;

-- Any item with an affinity list is a class_affinity item. An explicitly
-- class_exclusive item is never downgraded.
UPDATE items
SET item_type = 'class_affinity'
WHERE class_restricted IS NOT NULL
  AND class_restricted <> ''
  AND item_type <> 'class_exclusive';

-- Create only the missing synergy rows: a matching class receives +5% attack.
INSERT INTO item_class_bonuses (item_id, class_id, attack_percent, defense_percent,
                                hp_percent, crit_percent, dodge_percent,
                                lifesteal_percent, ai_resist_percent)
SELECT i.id, c.id, 5, 0, 0, 0, 0, 0, 0
FROM items i
JOIN classes c ON (',' || i.class_restricted || ',') LIKE ('%,' || c.code || ',%')
WHERE i.item_type = 'class_affinity'
  AND i.class_restricted IS NOT NULL
  AND i.class_restricted <> ''
ON CONFLICT (item_id, class_id) DO NOTHING;

-- Align descriptions with the effects that the combat engine actually applies.
-- debuff_duration and extra_action are implemented as a flat damage bonus.
UPDATE items SET description = '+300 HP, +20 DEF, +8% урона'
WHERE name = 'Мантия Архимага' AND slot = 'armor';

UPDATE items SET description = '+5% урона (упрощённое доп. действие)'
WHERE name = 'Сломанные часы' AND slot = 'accessory';

COMMIT;
