-- Seed initial data for NEMESIS Tower Game

-- Insert Classes
INSERT INTO classes (name, code, icon, description, base_hp, base_attack, base_defense, passive_ability) VALUES
('Берсерк', 'berserker', '⚔️', 'Мастер ближнего боя с высоким уроном', 120, 15, 3, 'Увеличение урона при низком HP'),
('Страж', 'guardian', '🛡', 'Защитник с высокой выживаемостью', 150, 8, 12, 'Поглощение части входящего урона'),
('Ассасин', 'assassin', '🗡', 'Быстрый боец с высоким шансом крита', 90, 12, 5, 'Увеличенный шанс критического удара'),
('Вампир', 'vampire', '🩸', 'Восстанавливает HP от нанесённого урона', 110, 10, 6, 'Lifesteal от атак'),
('Арканист', 'arcanist', '🧙', 'Маг с магическим уроном', 80, 14, 4, 'Магический урон игнорирует часть защиты'),
('Тактик', 'tactician', '🧠', 'Адаптируется к стилю противника', 100, 10, 8, 'Повышенное сопротивление AI'),
('Шут', 'jester', '🃏', 'Непредсказуемый боец', 95, 11, 7, 'Случайные эффекты в бою'),
('Некромант', 'necromancer', '☠️', 'Призывает мёртвых', 85, 9, 6, 'Призыв миньонов')
ON CONFLICT (code) DO NOTHING;

-- Insert some basic enemies for floors 1-10
INSERT INTO enemies (name, description, level, hp, attack, defense, is_boss, is_elite, floor_range_min, floor_range_max, abilities) VALUES
('Слабый скелет', 'Обычный скелет-воин', 1, 40, 6, 2, false, false, 1, 5, '[]'),
('Гоблин-разведчик', 'Мелкий гоблин', 1, 35, 7, 1, false, false, 1, 5, '[]'),
('Каменный голем', 'Медленный, но крепкий', 2, 60, 5, 8, false, false, 3, 7, '[]'),
('Теневой волк', 'Быстрый хищник', 2, 50, 9, 3, false, false, 3, 7, '[]'),
('Орк-воин', 'Сильный противник', 3, 80, 12, 5, false, false, 6, 10, '[]'),
('Страж Врат', 'Первый босс башни', 5, 200, 15, 10, true, false, 10, 10, '["Мощный удар", "Блок"]'),

-- Floors 11-20
('Ледяной элементаль', 'Замораживающая магия', 4, 90, 11, 4, false, false, 11, 15, '[]'),
('Огненный демон', 'Горящая ярость', 5, 110, 14, 6, false, false, 14, 18, '[]'),
('Костяной дракон', 'Босс 2 уровня', 8, 350, 20, 15, true, false, 20, 20, '["Огненное дыхание", "Хвост"]'),

-- Floors 21-30
('Химера', 'Трёхглавое чудовище', 6, 130, 16, 7, false, false, 21, 25, '[]'),
('Тёмный рыцарь', 'Проклятый воин', 7, 150, 18, 12, false, false, 24, 28, '[]'),
('Владыка Теней', 'Босс 3 уровня', 10, 500, 25, 18, true, false, 30, 30, '["Теневой шаг", "Проклятие"]')
ON CONFLICT DO NOTHING;

-- Insert some basic items
INSERT INTO items (name, description, slot, rarity, attack_bonus, defense_bonus, hp_bonus) VALUES
('Ржавый меч', 'Старый, но ещё режет', 'weapon', 'common', 5, 0, 0),
('Деревянный щит', 'Простая защита', 'shield', 'common', 0, 3, 0),
('Кожаная броня', 'Лёгкая защита', 'armor', 'common', 0, 5, 10),
('Стальной меч', 'Острое оружие', 'weapon', 'uncommon', 12, 0, 0),
('Железный щит', 'Надёжная защита', 'shield', 'uncommon', 0, 8, 5),
('Кольчуга', 'Средняя броня', 'armor', 'uncommon', 0, 10, 20),
('Меч героя', 'Легендарное оружие', 'weapon', 'legendary', 30, 0, 0),
('Щит стража', 'Непробиваемая защита', 'shield', 'legendary', 0, 25, 30)
ON CONFLICT DO NOTHING;

-- Create first season (current month)
INSERT INTO seasons (season_number, start_date, end_date, is_active, total_floors, zones_count)
VALUES (
    1,
    DATE_TRUNC('month', CURRENT_DATE),
    DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day',
    true,
    500,
    50
)
ON CONFLICT DO NOTHING;
