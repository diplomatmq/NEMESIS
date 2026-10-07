-- Class affinity and combat stats for equipment.
-- class_restricted is intentionally used as an affinity list: an item remains
-- usable by every class, while matching classes receive a synergy bonus.

ALTER TABLE player_progress
  ADD COLUMN IF NOT EXISTS crit_chance DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dodge DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifesteal DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_resist DECIMAL(5,2) DEFAULT 0;

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS item_type VARCHAR(30) NOT NULL DEFAULT 'universal',
  ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id);

CREATE TABLE IF NOT EXISTS item_class_bonuses (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  attack_percent DECIMAL(6,2) DEFAULT 0,
  defense_percent DECIMAL(6,2) DEFAULT 0,
  hp_percent DECIMAL(6,2) DEFAULT 0,
  crit_percent DECIMAL(6,2) DEFAULT 0,
  dodge_percent DECIMAL(6,2) DEFAULT 0,
  lifesteal_percent DECIMAL(6,2) DEFAULT 0,
  ai_resist_percent DECIMAL(6,2) DEFAULT 0,
  PRIMARY KEY (item_id, class_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_name_slot
  ON items (name, slot);

INSERT INTO items
  (name, description, slot, rarity, hp_bonus, attack_bonus, defense_bonus,
   crit_chance_bonus, dodge_bonus, lifesteal_bonus, ai_resist_bonus,
   special_effect, class_restricted, level_required)
VALUES
  ('Короткий топор', '+16 ATK, -2% DEF', 'weapon', 'common', 0, 16, 0, 0, 0, 0, 0, '-2% DEF', 'berserker', 1),
  ('Охотничий нож', '+12 ATK, +3% CRIT', 'weapon', 'common', 0, 12, 0, 3, 0, 0, 0, NULL, 'assassin', 1),
  ('Щит стражника', '+50 DEF, +5% BLOCK', 'shield', 'rare', 0, 0, 50, 0, 0, 0, 0, '+5% block', 'guardian', 1),
  ('Клинок вампира', '+70 ATK, +7% lifesteal', 'weapon', 'epic', 0, 70, 0, 0, 0, 7, 0, NULL, 'vampire', 10),
  ('Меч Бездны', '+85 ATK, +10% CRIT', 'weapon', 'epic', 0, 85, 0, 10, 0, 0, 0, 'ignore defense', 'assassin,arcanist', 10),
  ('Корона Бездны', '+300 HP, +10% AI RESIST', 'helmet', 'epic', 300, 0, 0, 0, 0, 0, 10, NULL, 'jester,arcanist', 10),
  ('Шлем Провидца', '+5% предсказания', 'helmet', 'rare', 0, 0, 0, 0, 0, 0, 5, NULL, 'tactician', 1),
  ('Маска Безумца', '+10% Dodge, -10 DEF', 'helmet', 'rare', 0, 0, -10, 0, 10, 0, 0, NULL, 'jester,assassin', 1),
  ('Броня крови', '+800 HP, +60 DEF', 'armor', 'epic', 800, 0, 60, 0, 0, 1, 0, NULL, 'vampire', 10),
  ('Тяжёлая броня титана', '+1000 HP, +120 DEF', 'armor', 'epic', 1000, 0, 120, 0, -10, 0, 0, NULL, 'guardian', 10),
  ('Сапоги Пустоты', '+12% Dodge, +5% AI RESIST', 'boots', 'epic', 0, 0, 0, 0, 12, 0, 5, NULL, 'jester,assassin', 10),
  ('Клык Берсерка', '+50 ATK, +10% урона при HP <50%', 'accessory', 'rare', 0, 50, 0, 0, 0, 0, 0, 'low_hp_damage', 'berserker', 1),
  ('Перчатка Контратаки', '+30 DEF, следующая атака после защиты сильнее', 'accessory', 'rare', 0, 0, 30, 0, 0, 0, 0, 'counter_attack', 'guardian', 1),
  ('Плащ Тени', '+10% Dodge', 'accessory', 'rare', 0, 0, 0, 0, 10, 0, 0, 'defend_dodge', 'assassin', 1),
  ('Глаз Ведьмы', '+10% CRIT, +10% AI RESIST', 'accessory', 'rare', 0, 0, 0, 10, 0, 0, 10, 'warn_ability', 'arcanist,jester', 1)
ON CONFLICT (name, slot) DO NOTHING;

UPDATE items i
SET item_type = 'class_affinity'
WHERE i.class_restricted IS NOT NULL
  AND i.class_restricted <> '';

INSERT INTO item_class_bonuses (item_id, class_id, attack_percent, defense_percent,
                                hp_percent, crit_percent, dodge_percent,
                                lifesteal_percent, ai_resist_percent)
SELECT i.id, c.id, 5, 0, 0, 0, 0, 0, 0
FROM items i
JOIN classes c ON (',' || i.class_restricted || ',') LIKE ('%,' || c.code || ',%')
WHERE i.item_type = 'class_affinity'
ON CONFLICT (item_id, class_id) DO NOTHING;

INSERT INTO items
  (name, description, slot, rarity, item_type, class_id, special_effect)
SELECT 'Сердце Ярости', 'Уникальная реликвия Берсерка', 'accessory', 'legendary',
       'class_exclusive', c.id, 'rage'
FROM classes c
WHERE c.code = 'berserker'
  AND NOT EXISTS (
    SELECT 1 FROM items WHERE name = 'Сердце Ярости' AND slot = 'accessory'
  );

-- Expanded equipment catalog. Affinity items remain usable by every class;
-- class_restricted only determines which class receives the synergy bonus.
INSERT INTO items
  (name, description, slot, rarity, hp_bonus, attack_bonus, defense_bonus,
   crit_chance_bonus, dodge_bonus, lifesteal_bonus, ai_resist_bonus,
   special_effect, class_restricted, level_required)
VALUES
  -- Weapons
  ('Ржавая сабля', '+10 ATK', 'weapon', 'common', 0, 10, 0, 0, 0, 0, 0, NULL, NULL, 1),
  ('Старый молот', '+20 ATK, -5% recovery', 'weapon', 'common', 0, 20, 0, 0, 0, 0, 0, '-5% recovery', 'guardian', 1),
  ('Клинок охотника', '+35 ATK, +7% CRIT, +5% урона элитам', 'weapon', 'rare', 0, 35, 0, 7, 0, 0, 0, 'elite_damage', 'assassin', 5),
  ('Кровавый топор', '+45 ATK, 3% lifesteal', 'weapon', 'rare', 0, 45, 0, 0, 0, 3, 0, NULL, 'berserker,vampire', 5),
  ('Клинок палача', '+55 ATK, +20% урона врагам ниже 30% HP', 'weapon', 'epic', 0, 55, 0, 0, 0, 0, 0, 'execute_damage', 'berserker', 10),
  ('Катана тени', '+40 ATK, +10% Dodge', 'weapon', 'epic', 0, 40, 0, 0, 10, 0, 0, 'after_defend_attack', 'assassin', 10),
  ('Клинок вампира', '+70 ATK, +7% lifesteal', 'weapon', 'epic', 0, 70, 0, 0, 0, 7, 0, NULL, 'vampire', 10),
  ('Меч берсерка', '+100 ATK, усиливается при низком HP', 'weapon', 'legendary', 0, 100, 0, 0, 0, 0, 0, 'low_hp_attack', 'berserker', 20),
  ('Клык Дракона', '+150 ATK, +15% CRIT, критический Burn', 'weapon', 'legendary', 0, 150, 0, 15, 0, 0, 0, 'critical_burn', 'berserker,arcanist', 30),
  ('Меч Короля', '+180 ATK, +15% обычного урона', 'weapon', 'legendary', 0, 180, 0, 0, 0, 0, 0, 'kill_next_attack', NULL, 40),
  ('Клинок Пустоты', '+200 ATK, +10% ignore DEF, +30% при правильном предсказании', 'weapon', 'mythic', 0, 200, 0, 0, 0, 0, 0, 'predicted_damage', 'jester,assassin', 50),
  ('Посох Бездны', '+70 ATK, +15% эффективность способностей', 'weapon', 'epic', 0, 70, 0, 0, 0, 0, 0, 'ability_power', 'arcanist', 15),

  -- Shields
  ('Щит стражника', '+50 DEF, +5% Block', 'shield', 'rare', 0, 0, 50, 0, 0, 0, 0, 'block', 'guardian', 5),
  ('Башенный щит', '+80 DEF, -5% Dodge', 'shield', 'rare', 0, 0, 80, 0, -5, 0, 0, NULL, 'guardian', 10),
  ('Щит отражения', '+70 DEF, 10% урона отражается', 'shield', 'epic', 0, 0, 70, 0, 0, 0, 0, 'reflect_damage', 'guardian', 15),
  ('Щит Бессмертного', '+120 DEF, 8% шанс полного блока', 'shield', 'epic', 0, 0, 120, 0, 0, 0, 0, 'perfect_block', 'guardian', 20),
  ('Щит Падшего Архонта', '+160 DEF, после защиты следующая атака +30%', 'shield', 'legendary', 0, 0, 160, 0, 0, 0, 0, 'guard_counter', 'guardian,tactician', 30),
  ('Щит Пустоты', '+180 DEF, 15% шанс игнорировать способность босса', 'shield', 'mythic', 0, 0, 180, 0, 0, 0, 0, 'ability_block', 'jester,guardian', 50),

  -- Armor
  ('Старая кожаная броня', '+100 HP, +10 DEF', 'armor', 'common', 100, 0, 10, 0, 0, 0, 0, NULL, NULL, 1),
  ('Стальная броня', '+400 HP, +50 DEF', 'armor', 'rare', 400, 0, 50, 0, 0, 0, 0, NULL, 'guardian', 10),
  ('Броня стражника', '+600 HP, +70 DEF, -3% урона', 'armor', 'epic', 600, 0, 70, 0, 0, 0, 0, 'damage_reduction', 'guardian', 15),
  ('Тяжёлая броня титана', '+1000 HP, +120 DEF, -10% Dodge', 'armor', 'legendary', 1000, 0, 120, 0, -10, 0, 0, NULL, 'guardian', 25),
  ('Броня крови', '+800 HP, +60 DEF, восстановление после атаки', 'armor', 'epic', 800, 0, 60, 0, 0, 1, 0, 'attack_regeneration', 'vampire', 15),
  ('Броня Бездны', '+1200 HP, +100 DEF, сопротивление эффектам', 'armor', 'legendary', 1200, 0, 100, 0, 0, 0, 5, 'status_resistance', 'arcanist,jester', 25),
  ('Броня Короля', '+2000 HP, +180 DEF, щит при критическом HP', 'armor', 'mythic', 2000, 0, 180, 0, 0, 0, 0, 'emergency_shield', 'guardian,berserker', 40),
  ('Мантия Архимага', '+500 HP, +20% сила эффектов', 'armor', 'legendary', 500, 0, 0, 0, 0, 0, 0, 'debuff_duration', 'arcanist', 25),

  -- Helmets
  ('Кожаный капюшон', '+50 HP, +5 DEF', 'helmet', 'common', 50, 0, 5, 0, 0, 0, 0, NULL, NULL, 1),
  ('Железный шлем', '+100 HP, +20 DEF', 'helmet', 'common', 100, 0, 20, 0, 0, 0, 0, NULL, NULL, 1),
  ('Шлем охотника', '+5% CRIT, +50 HP', 'helmet', 'rare', 50, 0, 0, 5, 0, 0, 0, NULL, 'assassin', 5),
  ('Шлем берсерка', '+10% ATK, -5 DEF', 'helmet', 'rare', 0, 10, -5, 0, 0, 0, 0, NULL, 'berserker', 5),
  ('Корона стражника', '+200 HP, +30 DEF', 'helmet', 'rare', 200, 0, 30, 0, 0, 0, 0, NULL, 'guardian', 10),
  ('Корона Бездны', '+300 HP, +10% AI RESIST', 'helmet', 'epic', 300, 0, 0, 0, 0, 0, 10, NULL, 'jester,arcanist', 15),
  ('Корона Архимага', '+250 HP, +20 Magic Power', 'helmet', 'legendary', 250, 20, 0, 0, 0, 0, 0, 'ability_power', 'arcanist', 25),

  -- Boots
  ('Старые сапоги', '+2% Dodge', 'boots', 'common', 0, 0, 0, 0, 2, 0, 0, NULL, NULL, 1),
  ('Сапоги охотника', '+5% Dodge, +3% CRIT', 'boots', 'rare', 0, 0, 0, 3, 5, 0, 0, NULL, 'assassin', 5),
  ('Сапоги странника', '+5% recovery', 'boots', 'rare', 0, 0, 0, 0, 0, 0, 0, 'recovery', 'tactician', 5),
  ('Железные сапоги', '+100 HP, +20 DEF, -5% Dodge', 'boots', 'common', 100, 0, 20, 0, -5, 0, 0, NULL, 'guardian', 5),
  ('Ледяные сапоги', '+10% Freeze Resistance, +5% Dodge', 'boots', 'rare', 0, 0, 0, 0, 5, 0, 0, 'freeze_resistance', NULL, 10),
  ('Сапоги Пустоты', '+12% Dodge, шанс избежать способности босса', 'boots', 'epic', 0, 0, 0, 0, 12, 0, 5, 'ability_evasion', 'jester,assassin', 20),
  ('Сапоги Хроноса', '+10% recovery, шанс избежать увеличения КД', 'boots', 'legendary', 0, 0, 0, 0, 0, 0, 0, 'cooldown_evasion', 'tactician', 30),

  -- Accessories
  ('Кольцо жизненной силы', '+300 HP', 'accessory', 'common', 300, 0, 0, 0, 0, 0, 0, NULL, NULL, 1),
  ('Сердце Титана', '+800 HP', 'accessory', 'rare', 800, 0, 0, 0, 0, 0, 0, NULL, 'guardian', 10),
  ('Амулет регенерации', '+1% HP каждый ход', 'accessory', 'rare', 0, 0, 0, 0, 0, 1, 0, 'regeneration', NULL, 5),
  ('Сердце Феникса', '+500 HP, воскресает один раз за бой', 'accessory', 'legendary', 500, 0, 0, 0, 0, 0, 0, 'revive', NULL, 20),
  ('Кольцо силы', '+30 ATK', 'accessory', 'common', 0, 30, 0, 0, 0, 0, 0, NULL, NULL, 1),
  ('Амулет разрушения', '+70 ATK, -5% DEF', 'accessory', 'rare', 0, 70, -5, 0, 0, 0, 0, NULL, 'berserker,assassin', 10),
  ('Сердце Дракона', '+100 ATK, +5% CRIT', 'accessory', 'epic', 0, 100, 0, 5, 0, 0, 0, NULL, NULL, 15),
  ('Кольцо стойкости', '+50 DEF', 'accessory', 'common', 0, 0, 50, 0, 0, 0, 0, NULL, NULL, 1),
  ('Амулет стражника', '+100 DEF, +200 HP', 'accessory', 'rare', 200, 0, 100, 0, 0, 0, 0, NULL, 'guardian', 10),
  ('Камень Титана', '+150 DEF, -5% Dodge', 'accessory', 'epic', 0, 0, 150, 0, -5, 0, 0, NULL, 'guardian', 15),
  ('Сердце крепости', '+300 DEF, первый удар -50%', 'accessory', 'legendary', 0, 0, 300, 0, 0, 0, 0, 'first_hit_reduction', 'guardian', 25),
  ('Маска Мертвеца', '+15% AI RESIST, скрывает последнее действие', 'accessory', 'epic', 0, 0, 0, 0, 0, 0, 15, 'hide_last_action', 'jester', 15),
  ('Кинжал Отчаяния', '+40 ATK, CRIT при низком HP', 'accessory', 'rare', 0, 40, 0, 0, 0, 0, 0, 'low_hp_crit', 'berserker,assassin', 10),
  ('Плащ Тени', '+10% Dodge, +20% после защиты', 'accessory', 'rare', 0, 0, 0, 0, 10, 0, 0, 'defend_dodge', 'assassin', 10),
  ('Амулет Мученика', '+500 HP, часть урона усиливает атаку', 'accessory', 'epic', 500, 0, 0, 0, 0, 0, 0, 'damage_to_attack', 'guardian,berserker', 15),
  ('Кольцо Жадности', '+15% урона, +10% получаемого урона, больше золота', 'accessory', 'epic', 0, 0, 0, 0, 0, 0, 0, 'greed', NULL, 15),
  ('Сломанные часы', '+5% recovery, шанс восстановить действие', 'accessory', 'rare', 0, 0, 0, 0, 0, 0, 0, 'extra_action', 'tactician', 10),
  ('Глаз Ведьмы', '+10% CRIT, +10% AI RESIST', 'accessory', 'rare', 0, 0, 0, 10, 0, 0, 10, 'warn_ability', 'arcanist,jester', 10),
  ('Кровавое сердце', '+1000 HP, потеря HP повышает ATK', 'accessory', 'legendary', 1000, 0, 0, 0, 0, 0, 0, 'lost_hp_attack', 'berserker,vampire', 25),
  ('Корона Безумного Короля', '+100 ATK, +100 DEF, +500 HP, меняющийся бонус', 'accessory', 'mythic', 500, 100, 100, 0, 0, 0, 0, 'changing_bonus', NULL, 40)
ON CONFLICT (name, slot) DO NOTHING;

-- Apply affinity metadata to the expanded catalog and create its default
-- class synergy rows after all catalog inserts have completed.
UPDATE items i
SET item_type = 'class_affinity'
WHERE i.class_restricted IS NOT NULL
  AND i.class_restricted <> '';

INSERT INTO item_class_bonuses (item_id, class_id, attack_percent, defense_percent,
                                hp_percent, crit_percent, dodge_percent,
                                lifesteal_percent, ai_resist_percent)
SELECT i.id, c.id, 5, 0, 0, 0, 0, 0, 0
FROM items i
JOIN classes c ON (',' || i.class_restricted || ',') LIKE ('%,' || c.code || ',%')
WHERE i.item_type = 'class_affinity'
ON CONFLICT (item_id, class_id) DO NOTHING;

-- One exclusive relic for each class. It has no base stats for other classes
-- and is rejected by equipItem when the class does not match.
INSERT INTO items
  (name, description, slot, rarity, item_type, class_id, special_effect)
SELECT exclusive_item.name, exclusive_item.description, 'accessory', 'legendary',
       'class_exclusive', c.id, exclusive_item.effect
FROM (
  VALUES
    ('Сердце Ярости', 'Эксклюзивная реликвия Берсерка', 'rage', 'berserker'),
    ('Ядро Стойкости', 'Эксклюзивная реликвия Стража', 'fortress', 'guardian'),
    ('Клинок Безымянного', 'Эксклюзивная реликвия Ассасина', 'unrepeated_crit', 'assassin'),
    ('Клык Первого Вампира', 'Эксклюзивная реликвия Вампира', 'ancient_lifesteal', 'vampire'),
    ('Фокус Архимага', 'Эксклюзивная реликвия Арканиста', 'spell_amplification', 'arcanist'),
    ('Компас Стратега', 'Эксклюзивная реликвия Тактика', 'sequence_mastery', 'tactician'),
    ('Маска Хаоса', 'Эксклюзивная реликвия Шута', 'ai_chaos', 'jester'),
    ('Череп Повелителя Мёртвых', 'Эксклюзивная реликвия Некроманта', 'summon', 'necromancer')
) AS exclusive_item(name, description, effect, class_code)
JOIN classes c ON c.code = exclusive_item.class_code
WHERE NOT EXISTS (
  SELECT 1 FROM items i
  WHERE i.name = exclusive_item.name AND i.slot = 'accessory'
);
