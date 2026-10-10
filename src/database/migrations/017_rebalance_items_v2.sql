-- Rebalance item stats v2 - Further reduce stats for better progression
-- This migration reduces equipment stats to make the game more challenging

-- Weapons - reduce attack bonuses
UPDATE items SET attack_bonus = 70 WHERE name = 'Меч берсерка' AND slot = 'weapon'; -- было 90
UPDATE items SET attack_bonus = 120 WHERE name = 'Клык Дракона' AND slot = 'weapon'; -- было 140
UPDATE items SET attack_bonus = 140 WHERE name = 'Меч Короля' AND slot = 'weapon'; -- было 160
UPDATE items SET attack_bonus = 160 WHERE name = 'Клинок Пустоты' AND slot = 'weapon'; -- было 180

-- Shields - reduce defense bonuses
UPDATE items SET defense_bonus = 30 WHERE name = 'Щит стражника' AND slot = 'shield'; -- было 40
UPDATE items SET defense_bonus = 55 WHERE name = 'Башенный щит' AND slot = 'shield'; -- было 70
UPDATE items SET defense_bonus = 50 WHERE name = 'Щит отражения' AND slot = 'shield'; -- было 60
UPDATE items SET defense_bonus = 80 WHERE name = 'Щит Бессмертного' AND slot = 'shield'; -- было 100
UPDATE items SET defense_bonus = 110 WHERE name = 'Щит Падшего Архонта' AND slot = 'shield'; -- было 140
UPDATE items SET defense_bonus = 120 WHERE name = 'Щит Пустоты' AND slot = 'shield'; -- было 150

-- Armor - reduce HP and defense bonuses
UPDATE items SET hp_bonus = 80, defense_bonus = 30 WHERE name = 'Старая кожаная броня' AND slot = 'armor'; -- было 100/40
UPDATE items SET hp_bonus = 280, defense_bonus = 35 WHERE name = 'Стальная броня' AND slot = 'armor'; -- было 350/40
UPDATE items SET hp_bonus = 400, defense_bonus = 50 WHERE name = 'Броня стражника' AND slot = 'armor'; -- было 500/60
UPDATE items SET hp_bonus = 500, defense_bonus = 40 WHERE name = 'Броня крови' AND slot = 'armor'; -- было 600/50
UPDATE items SET hp_bonus = 650, defense_bonus = 80 WHERE name = 'Тяжёлая броня титана' AND slot = 'armor'; -- было 800/100
UPDATE items SET hp_bonus = 750, defense_bonus = 65 WHERE name = 'Броня Бездны' AND slot = 'armor'; -- было 900/80
UPDATE items SET hp_bonus = 300, defense_bonus = 20 WHERE name = 'Мантия Архимага' AND slot = 'armor'; -- было 400/0
UPDATE items SET hp_bonus = 1100, defense_bonus = 120 WHERE name = 'Броня Короля' AND slot = 'armor'; -- было 1400/150

-- Helmets - reduce HP bonuses
UPDATE items SET hp_bonus = 40 WHERE name = 'Кожаный капюшон' AND slot = 'helmet'; -- было 50
UPDATE items SET hp_bonus = 80 WHERE name = 'Железный шлем' AND slot = 'helmet'; -- было 100
UPDATE items SET hp_bonus = 120 WHERE name = 'Корона стражника' AND slot = 'helmet'; -- было 150
UPDATE items SET hp_bonus = 180 WHERE name = 'Корона Бездны' AND slot = 'helmet'; -- было 220
UPDATE items SET hp_bonus = 160 WHERE name = 'Корона Архимага' AND slot = 'helmet'; -- было 200

-- Boots - reduce HP bonuses
UPDATE items SET hp_bonus = 60 WHERE name = 'Железные сапоги' AND slot = 'boots'; -- было 80

-- Accessories - reduce all bonuses
UPDATE items SET hp_bonus = 150 WHERE name = 'Кольцо жизненной силы' AND slot = 'accessory'; -- было 200
UPDATE items SET hp_bonus = 480 WHERE name = 'Сердце Титана' AND slot = 'accessory'; -- было 600
UPDATE items SET hp_bonus = 320 WHERE name = 'Сердце Феникса' AND slot = 'accessory'; -- было 400
UPDATE items SET hp_bonus = 320 WHERE name = 'Амулет Мученика' AND slot = 'accessory'; -- было 400
UPDATE items SET hp_bonus = 640 WHERE name = 'Кровавое сердце' AND slot = 'accessory'; -- было 800
UPDATE items SET hp_bonus = 320 WHERE name = 'Корона Безумного Короля' AND slot = 'accessory'; -- было 400

UPDATE items SET attack_bonus = 70 WHERE name = 'Сердце Дракона' AND slot = 'accessory'; -- было 90
UPDATE items SET defense_bonus = 65 WHERE name = 'Амулет стражника' AND slot = 'accessory'; -- было 80
UPDATE items SET defense_bonus = 100 WHERE name = 'Камень Титана' AND slot = 'accessory'; -- было 130
UPDATE items SET defense_bonus = 200 WHERE name = 'Сердце крепости' AND slot = 'accessory'; -- было 250
UPDATE items SET attack_bonus = 65, defense_bonus = 65 WHERE name = 'Корона Безумного Короля' AND slot = 'accessory'; -- было 80/80

-- Class exclusive items - reduce bonuses
UPDATE items 
SET hp_bonus = 150, attack_bonus = 20, defense_bonus = 10
WHERE item_type = 'class_exclusive'; -- было 200/25/12

COMMENT ON COLUMN items.attack_bonus IS 'Attack bonus (v2: reduced for better game balance)';
COMMENT ON COLUMN items.defense_bonus IS 'Defense bonus (v2: reduced for better game balance)';
COMMENT ON COLUMN items.hp_bonus IS 'HP bonus (v2: reduced for better game balance)';
