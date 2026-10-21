-- Migration 022: Add 40 new items and buff all bosses

BEGIN;

-- ==========================================
-- PART 1: ADD 40 NEW ITEMS
-- ==========================================

INSERT INTO items
  (name, description, slot, rarity, hp_bonus, attack_bonus, defense_bonus,
   crit_chance_bonus, dodge_bonus, lifesteal_bonus, ai_resist_bonus,
   special_effect, class_restricted, level_required)
VALUES
  -- ⚔️ WEAPONS (10 items)
  ('Крушитель костей', '+30 ATK, +5 DEF, +8% урона оглушённым врагам', 'weapon', 'rare', 0, 30, 5, 0, 0, 0, 0, 'stun_damage', 'berserker,guardian', 5),
  ('Игла Призрака', '+28 ATK, +4% CRIT, +5% игнора защиты', 'weapon', 'rare', 0, 28, 0, 4, 0, 0, 0, 'armor_pierce', 'assassin', 5),
  ('Посох душ', '+25 ATK, +10 Magic Power, призывы +8% урона', 'weapon', 'rare', 0, 25, 0, 0, 0, 0, 0, 'summon_damage', 'necromancer', 5),
  ('Клинок возмездия', '+55 ATK, +5% CRIT, после защиты +15% урона атаке', 'weapon', 'epic', 0, 55, 0, 5, 0, 0, 0, 'defend_attack_boost', 'guardian,tactician', 10),
  ('Серп кровопийцы', '+45 ATK, +5% lifesteal, лечение +10% при HP <40%', 'weapon', 'epic', 0, 45, 0, 0, 0, 5, 0, 'low_hp_lifesteal', 'vampire', 10),
  ('Гримуар отражений', '+40 ATK, +15 Magic Power, отражённый урон +10%', 'weapon', 'epic', 0, 40, 0, 0, 0, 0, 0, 'reflect_boost', 'arcanist', 15),
  ('Клинок вероятности', '+50 ATK, +5% CRIT, при крите 15% на +25% урона', 'weapon', 'epic', 0, 50, 0, 5, 0, 0, 0, 'crit_bonus', 'jester', 15),
  ('Молот последнего рубежа', '+85 ATK, +50 DEF, при HP <30% урон -8%', 'weapon', 'legendary', 0, 85, 50, 0, 0, 0, 0, 'low_hp_defense', 'guardian,berserker', 25),
  ('Коса вечного слуги', '+70 ATK, +15% урона миньонов, миньон → 10% энергии', 'weapon', 'legendary', 0, 70, 0, 0, 0, 0, 0, 'minion_return', 'necromancer', 30),
  ('Раскалыватель времени', '+120 ATK, +8% CRIT, после предугадывания +20% урона', 'weapon', 'mythic', 0, 120, 0, 8, 0, 0, 0, 'prediction_damage', 'tactician,arcanist', 45),

  -- 🛡️ SHIELDS (6 items)
  ('Щит последнего рубежа', '+60 DEF, при HP <25% урон -5%', 'shield', 'rare', 0, 0, 60, 0, 0, 0, 0, 'last_stand_def', 'guardian', 5),
  ('Зеркальный баклер', '+65 DEF, +3% Dodge, отражает 15% полученного урона', 'shield', 'epic', 0, 0, 65, 0, 3, 0, 0, 'mirror_reflect', 'guardian,tactician', 10),
  ('Щит живой стали', '+85 DEF, после защиты восстанавливает 2% макс. HP', 'shield', 'epic', 0, 0, 85, 0, 0, 0, 0, 'living_shield', 'guardian', 15),
  ('Щит призрачного легиона', '+55 DEF, +100 HP, миньоны получают -10% урона', 'shield', 'epic', 100, 0, 55, 0, 0, 0, 0, 'minion_protection', 'necromancer,guardian', 15),
  ('Щит идеального момента', '+100 DEF, +3% AI RES, после парирования +15% урона', 'shield', 'legendary', 0, 0, 100, 0, 0, 0, 3, 'perfect_parry', 'tactician,guardian', 30),
  ('Эгида обратного удара', '+130 DEF, +200 HP, раз за бой: поглощает 40% урона >25% HP', 'shield', 'mythic', 200, 0, 130, 0, 0, 0, 0, 'aegis_absorb', 'guardian,jester', 45),

  -- 🥋 ARMOR (5 items)
  ('Кольчуга ярости', '+250 HP, +25 DEF, при HP <40% +5% ATK', 'armor', 'rare', 250, 0, 25, 0, 0, 0, 0, 'rage_armor', 'berserker', 5),
  ('Мантия теневого шага', '+300 HP, +30 DEF, +3% Dodge, после уклонения +5% Dodge', 'armor', 'epic', 300, 0, 30, 0, 3, 0, 0, 'shadow_step', 'assassin,jester', 15),
  ('Доспех пожирателя душ', '+350 HP, +35 DEF, при гибели миньона щит 5% HP', 'armor', 'epic', 350, 0, 35, 0, 0, 0, 0, 'soul_shield', 'necromancer', 15),
  ('Панцирь расколотого времени', '+600 HP, +65 DEF, первый дебафф -30% длительность', 'armor', 'legendary', 600, 0, 65, 0, 0, 0, 0, 'time_resist', 'tactician,arcanist', 30),
  ('Сердце каменного титана', '+900 HP, +100 DEF, если урон >30% HP дополнительно -10%', 'armor', 'mythic', 900, 0, 100, 0, 0, 0, 0, 'titan_heart', 'guardian', 45),

  -- 🪖 HELMETS (4 items)
  ('Маска последнего вздоха', '+100 HP, +3% CRIT, при HP <25% +5% CRIT', 'helmet', 'rare', 100, 0, 0, 3, 0, 0, 0, 'desperation_crit', 'berserker,assassin', 5),
  ('Венец предвидения', '+150 HP, +5% AI RES, при предугадывании +5% DEF на удар', 'helmet', 'epic', 150, 0, 0, 0, 0, 0, 5, 'foresight_def', 'tactician', 15),
  ('Череп безмолвия', '+180 HP, +10 Magic Power, контроль -15% длительность', 'helmet', 'epic', 180, 0, 0, 0, 0, 0, 0, 'cc_reduction', 'necromancer,arcanist', 20),
  ('Корона последнего шанса', '+250 HP, +25 DEF, раз за бой: при <15% HP щит 10% HP', 'helmet', 'legendary', 250, 0, 25, 0, 0, 0, 0, 'last_hope', 'guardian,berserker', 30),

  -- 🥾 BOOTS (4 items)
  ('Сапоги контрудара', '+100 HP, +2% Dodge, после уклонения +5% ATK до атаки', 'boots', 'rare', 100, 0, 0, 0, 2, 0, 0, 'counter_strike', 'assassin', 5),
  ('Сапоги несгибаемости', '+200 HP, +20 DEF, замедление -20% длительность', 'boots', 'epic', 200, 0, 20, 0, 0, 0, 0, 'slow_resist', 'guardian,berserker', 15),
  ('Сапоги призрачной поступи', '+5% Dodge, +3% AI RES, +10% уклонения от 1-й атаки босса', 'boots', 'epic', 0, 0, 0, 0, 5, 0, 3, 'first_strike_dodge', 'jester,assassin', 20),
  ('Хроносапоги возмездия', '+250 HP, +5% recovery, после защиты КД -5%', 'boots', 'legendary', 250, 0, 0, 0, 0, 0, 0, 'time_strike', 'tactician', 30),

  -- 💍 ACCESSORIES (11 items)
  ('Кольцо отражённой боли', '+20 DEF, +5% к отражению урона', 'accessory', 'rare', 0, 0, 20, 0, 0, 0, 0, 'reflect_ring', 'guardian,vampire', 5),
  ('Медальон ярости', '+35 ATK, при HP <50% +5% урона', 'accessory', 'rare', 0, 35, 0, 0, 0, 0, 0, 'fury_medallion', 'berserker', 5),
  ('Подвеска призрачного шага', '+100 HP, +3% Dodge, после уклонения восстанавливает 2% HP', 'accessory', 'rare', 100, 0, 0, 0, 3, 0, 0, 'ghost_pendant', 'assassin', 5),
  ('Амулет накопленной силы', '+25 ATK, +20 DEF, защита → заряд, макс +5% урона', 'accessory', 'rare', 0, 25, 20, 0, 0, 0, 0, 'charge_amulet', 'tactician,guardian', 10),
  ('Око поглощения', '+150 HP, поглощение урона → 5% энергии', 'accessory', 'epic', 150, 0, 0, 0, 0, 0, 0, 'absorption_eye', 'arcanist', 15),
  ('Печать кровавой клятвы', '+50 ATK, +200 HP, lifesteal +10% эффективность', 'accessory', 'epic', 200, 50, 0, 0, 0, 0, 0, 'blood_seal', 'vampire', 15),
  ('Кость удачи', '+4% CRIT, +3% Dodge, раз за бой: одна характеристика +10%', 'accessory', 'epic', 0, 0, 0, 4, 3, 0, 0, 'lucky_bone', 'jester', 15),
  ('Жетон бессмертного слуги', '+200 HP, первый погибший миньон → щит 5% HP', 'accessory', 'epic', 200, 0, 0, 0, 0, 0, 0, 'immortal_servant', 'necromancer', 20),
  ('Сердце идеального парирования', '+50 DEF, +100 HP, после парирования восстанавливает 3% HP', 'accessory', 'legendary', 100, 0, 50, 0, 0, 0, 0, 'parry_heart', 'guardian,tactician', 30),
  ('Часы последнего шанса', '+300 HP, раз за бой: смертельный удар → 1 HP, следующий урон -20%', 'accessory', 'legendary', 300, 0, 0, 0, 0, 0, 0, 'last_chance', NULL, 35),
  ('Печать восьми судеб', '+50 ATK, +50 DEF, +250 HP, раз за бой: защитная способность +15%', 'accessory', 'mythic', 250, 50, 50, 0, 0, 0, 0, 'eight_fates', NULL, 45)

ON CONFLICT (name, slot) DO NOTHING;

-- Update item types for affinity items
UPDATE items i
SET item_type = 'class_affinity'
WHERE i.class_restricted IS NOT NULL
  AND i.class_restricted <> ''
  AND i.item_type != 'class_exclusive';

-- Add class bonuses for new affinity items
INSERT INTO item_class_bonuses (item_id, class_id, attack_percent, defense_percent,
                                hp_percent, crit_percent, dodge_percent,
                                lifesteal_percent, ai_resist_percent)
SELECT i.id, c.id, 5, 0, 0, 0, 0, 0, 0
FROM items i
JOIN classes c ON (',' || i.class_restricted || ',') LIKE ('%,' || c.code || ',%')
WHERE i.item_type = 'class_affinity'
  AND i.level_required >= 5 -- Only new items from this migration
ON CONFLICT (item_id, class_id) DO NOTHING;

-- ==========================================
-- PART 2: BUFF ALL BOSSES
-- ==========================================

-- Increase boss HP by 30-40 and defense by 10-15
UPDATE enemies
SET 
  hp = hp + (30 + FLOOR(RANDOM() * 11))::INTEGER,
  defense = defense + (10 + FLOOR(RANDOM() * 6))::INTEGER
WHERE is_boss = true;

-- Season 1 boss stats come from BossSystem.getExpandedBossConfigs() in code,
-- which is the single source of truth. There is no boss_configs table, so the
-- previous SQL tweak here targeted a non-existent table and aborted the whole
-- migration transaction.

COMMIT;
