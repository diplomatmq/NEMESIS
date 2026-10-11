-- Migration 021: Update class passive abilities with new defense mechanics

BEGIN;

UPDATE classes SET passive_ability = 'Ярость боли: снижает урон на 35% (45% при HP < 30%), 30% предотвращённого урона → бонус к атаке' WHERE code = 'berserker';

UPDATE classes SET passive_ability = 'Неприступная крепость: снижает урон на 55%, восстанавливает 5% макс. HP после получения урона' WHERE code = 'guardian';

UPDATE classes SET passive_ability = 'Теневой рефлекс: 40% шанс полного уклонения + контратака (50% урона)' WHERE code = 'assassin';

UPDATE classes SET passive_ability = 'Кровавое возмездие: снижает урон на 25%, отражает 25% полученного урона, лечит 15% от отражённого' WHERE code = 'vampire';

UPDATE classes SET passive_ability = 'Магический барьер: поглощает 40% урона, получает энергию (20% от предотвращённого), усиливает атаку до +10%' WHERE code = 'arcanist';

UPDATE classes SET passive_ability = 'Предугадывание: снижает урон на 45% при верном прогнозе действия врага, +10% урона к атаке' WHERE code = 'tactician';

UPDATE classes SET passive_ability = 'Роковая случайность: случайный эффект - Фокус (20%: уклонение), Зеркало (30%: -35% урона + 20% отражение), Подмена (50%: -40% урона)' WHERE code = 'jester';

UPDATE classes SET passive_ability = 'Душа вместо плоти: миньон поглощает 50% урона (без миньона: 30% призрачный щит)' WHERE code = 'necromancer';

COMMIT;
