-- Migration 027: explicit potion heal types, class description sync,
-- defensive item rebalance and level sync with tower progress.

BEGIN;

-- 1. Explicit potion heal definition instead of deriving it from hp_bonus
ALTER TABLE items ADD COLUMN IF NOT EXISTS potion_heal_type VARCHAR(20);
ALTER TABLE items ADD COLUMN IF NOT EXISTS potion_heal_value INTEGER;

UPDATE items SET potion_heal_type = 'percentage', potion_heal_value = 20,
    description = 'Восстанавливает 20% HP'
  WHERE slot = 'potion' AND name = 'Малое зелье здоровья';

UPDATE items SET potion_heal_type = 'percentage', potion_heal_value = 30,
    description = 'Восстанавливает 30% HP'
  WHERE slot = 'potion' AND name = 'Зелье здоровья';

UPDATE items SET potion_heal_type = 'percentage', potion_heal_value = 40,
    description = 'Восстанавливает 40% HP'
  WHERE slot = 'potion' AND name = 'Большое зелье здоровья';

-- Fallback for any other potion rows created earlier
UPDATE items SET potion_heal_type = 'percentage', potion_heal_value = 20
  WHERE slot = 'potion' AND (potion_heal_type IS NULL OR potion_heal_value IS NULL);

-- 2. Sync class passive descriptions with the actual combat engine values
UPDATE classes SET passive_ability = 'Ярость боли: снижает урон на 35% (45% при HP < 30%), +15% к следующей атаке' WHERE code = 'berserker';
UPDATE classes SET passive_ability = 'Неприступная крепость: снижает урон на 50%, восстанавливает 2% макс. HP (до 10% за бой), +5% к следующей атаке' WHERE code = 'guardian';
UPDATE classes SET passive_ability = 'Теневой рефлекс: 40% шанс полного уклонения + контратака (50% урона), иначе урон снижен на 40%' WHERE code = 'assassin';
UPDATE classes SET passive_ability = 'Кровавое возмездие: снижает урон на 35%, отражает 15% полученного урона, лечит 15% от отражённого' WHERE code = 'vampire';
UPDATE classes SET passive_ability = 'Магический барьер: поглощает 45% урона, усиливает атаку до +25%' WHERE code = 'arcanist';
UPDATE classes SET passive_ability = 'Предугадывание: снижает урон на 50%, +20% урона к следующей атаке' WHERE code = 'tactician';
UPDATE classes SET passive_ability = 'Роковая случайность: Фокус (20%: уклонение), Зеркало (30%: -35% урона + 20% отражение), Подмена (50%: -40% урона)' WHERE code = 'jester';
UPDATE classes SET passive_ability = 'Душа вместо плоти: миньон поглощает 50% урона (без миньона: 40% призрачный щит)' WHERE code = 'necromancer';

-- 3. Rebalance the strongest defensive items
UPDATE items SET hp_bonus = 600, defense_bonus = 60,
    description = '+600 HP, +60 DEF, если урон >30% HP дополнительно -10%'
  WHERE name = 'Сердце каменного титана' AND slot = 'armor';

UPDATE items SET hp_bonus = 150, defense_bonus = 80,
    description = '+80 DEF, +150 HP, раз за бой: поглощает 40% урона >25% HP'
  WHERE name = 'Эгида обратного удара' AND slot = 'shield';

UPDATE items SET defense_bonus = 100,
    description = '+100 DEF, первый удар -50%'
  WHERE name = 'Сердце крепости' AND slot = 'accessory';

UPDATE items SET defense_bonus = 80,
    description = '+80 DEF, 15% шанс игнорировать способность босса'
  WHERE name = 'Щит Пустоты' AND slot = 'shield';

UPDATE items SET defense_bonus = 75,
    description = '+75 DEF, после защиты следующая атака +30%'
  WHERE name = 'Щит Падшего Архонта' AND slot = 'shield';

UPDATE items SET attack_bonus = 60, defense_bonus = 25,
    description = '+60 ATK, +25 DEF, при HP <30% урон -8%'
  WHERE name = 'Молот последнего рубежа' AND slot = 'weapon';

-- 4. Sync stored level with tower progress for existing players
UPDATE player_progress SET level = FLOOR((floor - 1) / 10) + 1;

COMMIT;
