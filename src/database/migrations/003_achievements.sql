-- Achievements system

CREATE TABLE IF NOT EXISTS achievements (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(10),
    category VARCHAR(50),
    requirement_type VARCHAR(50),
    requirement_value INTEGER,
    reward_gold INTEGER DEFAULT 0,
    reward_title VARCHAR(255),
    is_secret BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_achievements_code ON achievements(code);
CREATE INDEX IF NOT EXISTS idx_achievements_category ON achievements(category);

CREATE TABLE IF NOT EXISTS player_achievements (
    id SERIAL PRIMARY KEY,
    player_progress_id INTEGER REFERENCES player_progress(id) ON DELETE CASCADE,
    achievement_id INTEGER REFERENCES achievements(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    progress INTEGER DEFAULT 0,
    UNIQUE(player_progress_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_player_achievements_player ON player_achievements(player_progress_id);

-- Insert initial achievements
INSERT INTO achievements (code, name, description, icon, category, requirement_type, requirement_value, reward_gold, reward_title) VALUES
('first_steps', 'Первые шаги', 'Пройдите этаж 1', '👣', 'progress', 'floor_reached', 1, 50, NULL),
('floor_10', 'Первая высота', 'Достигните этажа 10', '🏔️', 'progress', 'floor_reached', 10, 100, NULL),
('floor_50', 'Средние этажи', 'Достигните этажа 50', '🏰', 'progress', 'floor_reached', 50, 500, 'Покоритель башни'),
('floor_100', 'Сотня', 'Достигните этажа 100', '💯', 'progress', 'floor_reached', 100, 1000, 'Столпотворец'),
('floor_250', 'Четверть пути', 'Достигните этажа 250', '⭐', 'progress', 'floor_reached', 250, 2500, 'Легендарный воин'),
('floor_500', 'Вершина', 'Достигните вершины башни (этаж 500)', '👑', 'progress', 'floor_reached', 500, 10000, 'Повелитель NEMESIS'),

('first_boss', 'Убийца боссов', 'Победите первого босса', '👹', 'combat', 'bosses_killed', 1, 100, NULL),
('boss_hunter', 'Охотник на боссов', 'Победите 10 боссов', '🗡️', 'combat', 'bosses_killed', 10, 500, 'Охотник'),
('boss_slayer', 'Истребитель боссов', 'Победите 50 боссов', '⚔️', 'combat', 'bosses_killed', 50, 2500, 'Истребитель'),

('class_master', 'Мастер класса', 'Достигните 100 уровня', '🎓', 'progress', 'level_reached', 100, 5000, 'Мастер'),

('rich', 'Богач', 'Накопите 10000 золота', '💰', 'economy', 'gold_total', 10000, 0, 'Богач'),
('collector', 'Коллекционер', 'Соберите 50 уникальных предметов', '📦', 'items', 'unique_items', 50, 1000, 'Коллекционер'),
('legendary_owner', 'Владелец легенды', 'Получите легендарный предмет', '⭐', 'items', 'legendary_items', 1, 500, NULL),

('survivor', 'Выживший', 'Умрите и возродитесь 10 раз', '💀', 'combat', 'deaths', 10, 0, 'Неубиваемый'),
('veteran', 'Ветеран', 'Проведите 100 боёв', '⚔️', 'combat', 'battles', 100, 1000, NULL),

('fast_climber', 'Скоростной альпинист', 'Достигните этажа 50 за один сезон', '⚡', 'special', 'floor_in_season', 50, 1500, 'Скороход'),
('completionist', 'Перфекционист', 'Получите все достижения', '🏆', 'special', 'all_achievements', 1, 50000, 'Абсолютный Покоритель')
ON CONFLICT (code) DO NOTHING;
