-- Rebalance item stats for better game progression
-- HP bonuses were too high, making early-game items overpowered

-- Rebalance HP bonuses to be more progressive
-- Common: 50-150 HP
-- Rare: 150-300 HP  
-- Epic: 300-600 HP
-- Legendary: 600-1000 HP
-- Mythic: 1000-1500 HP

-- Helmets (head slot - moderate HP)
UPDATE items SET hp_bonus = 50 WHERE name = 'Кожаный капюшон' AND slot = 'helmet';
UPDATE items SET hp_bonus = 100 WHERE name = 'Железный шлем' AND slot = 'helmet';
UPDATE items SET hp_bonus = 150 WHERE name = 'Корона стражника' AND slot = 'helmet';
UPDATE items SET hp_bonus = 220 WHERE name = 'Корона Бездны' AND slot = 'helmet'; -- было 300
UPDATE items SET hp_bonus = 200 WHERE name = 'Корона Архимага' AND slot = 'helmet';

-- Armor (chest slot - high HP)
UPDATE items SET hp_bonus = 100 WHERE name = 'Старая кожаная броня' AND slot = 'armor';
UPDATE items SET hp_bonus = 350 WHERE name = 'Стальная броня' AND slot = 'armor'; -- было 400
UPDATE items SET hp_bonus = 500 WHERE name = 'Броня стражника' AND slot = 'armor'; -- было 600
UPDATE items SET hp_bonus = 600 WHERE name = 'Броня крови' AND slot = 'armor'; -- было 800
UPDATE items SET hp_bonus = 800 WHERE name = 'Тяжёлая броня титана' AND slot = 'armor'; -- было 1000
UPDATE items SET hp_bonus = 900 WHERE name = 'Броня Бездны' AND slot = 'armor'; -- было 1200
UPDATE items SET hp_bonus = 400 WHERE name = 'Мантия Архимага' AND slot = 'armor'; -- было 500
UPDATE items SET hp_bonus = 1400 WHERE name = 'Броня Короля' AND slot = 'armor'; -- было 2000

-- Boots (feet slot - low HP)
UPDATE items SET hp_bonus = 80 WHERE name = 'Железные сапоги' AND slot = 'boots'; -- было 100

-- Accessories (various HP bonuses)
UPDATE items SET hp_bonus = 200 WHERE name = 'Кольцо жизненной силы' AND slot = 'accessory'; -- было 300, теперь 200-230 с вариацией
UPDATE items SET hp_bonus = 600 WHERE name = 'Сердце Титана' AND slot = 'accessory'; -- было 800
UPDATE items SET hp_bonus = 400 WHERE name = 'Сердце Феникса' AND slot = 'accessory'; -- было 500
UPDATE items SET hp_bonus = 400 WHERE name = 'Амулет Мученика' AND slot = 'accessory'; -- было 500
UPDATE items SET hp_bonus = 800 WHERE name = 'Кровавое сердце' AND slot = 'accessory'; -- было 1000
UPDATE items SET hp_bonus = 400 WHERE name = 'Корона Безумного Короля' AND slot = 'accessory'; -- было 500

-- Class exclusive items (legendary accessories)
UPDATE items 
SET hp_bonus = 200, attack_bonus = 25, defense_bonus = 12
WHERE item_type = 'class_exclusive'; -- было 300/30/15

-- Balance defense bonuses for shields
UPDATE items SET defense_bonus = 40 WHERE name = 'Щит стражника' AND slot = 'shield'; -- было 50
UPDATE items SET defense_bonus = 70 WHERE name = 'Башенный щит' AND slot = 'shield'; -- было 80
UPDATE items SET defense_bonus = 60 WHERE name = 'Щит отражения' AND slot = 'shield'; -- было 70
UPDATE items SET defense_bonus = 100 WHERE name = 'Щит Бессмертного' AND slot = 'shield'; -- было 120
UPDATE items SET defense_bonus = 140 WHERE name = 'Щит Падшего Архонта' AND slot = 'shield'; -- было 160
UPDATE items SET defense_bonus = 150 WHERE name = 'Щит Пустоты' AND slot = 'shield'; -- было 180

-- Balance defense bonuses for armor
UPDATE items SET defense_bonus = 40 WHERE name = 'Стальная броня' AND slot = 'armor'; -- было 50
UPDATE items SET defense_bonus = 60 WHERE name = 'Броня стражника' AND slot = 'armor'; -- было 70
UPDATE items SET defense_bonus = 50 WHERE name = 'Броня крови' AND slot = 'armor'; -- было 60
UPDATE items SET defense_bonus = 100 WHERE name = 'Тяжёлая броня титана' AND slot = 'armor'; -- было 120
UPDATE items SET defense_bonus = 80 WHERE name = 'Броня Бездны' AND slot = 'armor'; -- было 100
UPDATE items SET defense_bonus = 150 WHERE name = 'Броня Короля' AND slot = 'armor'; -- было 180

-- Balance attack bonuses for weapons
UPDATE items SET attack_bonus = 140 WHERE name = 'Клык Дракона' AND slot = 'weapon'; -- было 150
UPDATE items SET attack_bonus = 160 WHERE name = 'Меч Короля' AND slot = 'weapon'; -- было 180
UPDATE items SET attack_bonus = 180 WHERE name = 'Клинок Пустоты' AND slot = 'weapon'; -- было 200
UPDATE items SET attack_bonus = 90 WHERE name = 'Меч берсерка' AND slot = 'weapon'; -- было 100

-- Balance accessories
UPDATE items SET attack_bonus = 90 WHERE name = 'Сердце Дракона' AND slot = 'accessory'; -- было 100
UPDATE items SET defense_bonus = 80 WHERE name = 'Амулет стражника' AND slot = 'accessory'; -- было 100
UPDATE items SET defense_bonus = 130 WHERE name = 'Камень Титана' AND slot = 'accessory'; -- было 150
UPDATE items SET defense_bonus = 250 WHERE name = 'Сердце крепости' AND slot = 'accessory'; -- было 300
UPDATE items SET attack_bonus = 80, defense_bonus = 80 WHERE name = 'Корона Безумного Короля' AND slot = 'accessory'; -- было 100/100

COMMENT ON TABLE items IS 'Equipment items with rebalanced stats for progressive difficulty';
