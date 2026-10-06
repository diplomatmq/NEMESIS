-- Initial Database Schema for NEMESIS Tower Game

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_start_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_users_telegram_id ON users(telegram_id);

-- Chats table
CREATE TABLE IF NOT EXISTS chats (
    id SERIAL PRIMARY KEY,
    telegram_chat_id BIGINT UNIQUE NOT NULL,
    chat_type VARCHAR(50),
    title VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chats_telegram_chat_id ON chats(telegram_chat_id);

-- Seasons table
CREATE TABLE IF NOT EXISTS seasons (
    id SERIAL PRIMARY KEY,
    season_number INTEGER UNIQUE NOT NULL,
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT false,
    total_floors INTEGER DEFAULT 500,
    zones_count INTEGER DEFAULT 50,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_seasons_active ON seasons(is_active) WHERE is_active = true;

-- Classes table
CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    icon VARCHAR(10),
    description TEXT,
    base_hp INTEGER DEFAULT 100,
    base_attack INTEGER DEFAULT 10,
    base_defense INTEGER DEFAULT 5,
    passive_ability TEXT
);

-- Player Progress table
CREATE TABLE IF NOT EXISTS player_progress (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id),
    floor INTEGER DEFAULT 1,
    hp INTEGER DEFAULT 100,
    max_hp INTEGER DEFAULT 100,
    attack INTEGER DEFAULT 10,
    defense INTEGER DEFAULT 5,
    gold INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    checkpoint_floor INTEGER DEFAULT 1,
    current_enemy_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chat_id, season_id)
);

CREATE INDEX idx_player_progress_user_chat_season ON player_progress(user_id, chat_id, season_id);
CREATE INDEX idx_player_progress_floor ON player_progress(floor);

-- Cooldowns table
CREATE TABLE IF NOT EXISTS cooldowns (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    action_type VARCHAR(50) DEFAULT 'combat',
    available_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chat_id, action_type)
);

CREATE INDEX idx_cooldowns_user_chat ON cooldowns(user_id, chat_id);
CREATE INDEX idx_cooldowns_available_at ON cooldowns(available_at);

-- Enemies table
CREATE TABLE IF NOT EXISTS enemies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    level INTEGER DEFAULT 1,
    hp INTEGER NOT NULL,
    attack INTEGER NOT NULL,
    defense INTEGER NOT NULL,
    is_boss BOOLEAN DEFAULT false,
    is_elite BOOLEAN DEFAULT false,
    floor_range_min INTEGER,
    floor_range_max INTEGER,
    abilities JSONB DEFAULT '[]',
    ai_personality JSONB,
    loot_table_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_enemies_floor_range ON enemies(floor_range_min, floor_range_max);
CREATE INDEX idx_enemies_is_boss ON enemies(is_boss);

-- Items table
CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    slot VARCHAR(50),
    rarity VARCHAR(50) DEFAULT 'common',
    hp_bonus INTEGER DEFAULT 0,
    attack_bonus INTEGER DEFAULT 0,
    defense_bonus INTEGER DEFAULT 0,
    crit_chance_bonus DECIMAL(5,2) DEFAULT 0,
    dodge_bonus DECIMAL(5,2) DEFAULT 0,
    lifesteal_bonus DECIMAL(5,2) DEFAULT 0,
    ai_resist_bonus DECIMAL(5,2) DEFAULT 0,
    special_effect TEXT,
    class_restricted VARCHAR(50),
    level_required INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_items_slot ON items(slot);
CREATE INDEX idx_items_rarity ON items(rarity);

-- Player Inventory table
CREATE TABLE IF NOT EXISTS player_inventory (
    id SERIAL PRIMARY KEY,
    player_progress_id INTEGER REFERENCES player_progress(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(id),
    quantity INTEGER DEFAULT 1,
    acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_inventory_player ON player_inventory(player_progress_id);

-- Player Equipment table
CREATE TABLE IF NOT EXISTS player_equipment (
    id SERIAL PRIMARY KEY,
    player_progress_id INTEGER REFERENCES player_progress(id) ON DELETE CASCADE,
    weapon_id INTEGER REFERENCES items(id),
    shield_id INTEGER REFERENCES items(id),
    helmet_id INTEGER REFERENCES items(id),
    armor_id INTEGER REFERENCES items(id),
    boots_id INTEGER REFERENCES items(id),
    accessory_id INTEGER REFERENCES items(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(player_progress_id)
);

-- Pending Payments table
CREATE TABLE IF NOT EXISTS pending_payments (
    id SERIAL PRIMARY KEY,
    telegram_user_id BIGINT NOT NULL,
    chat_id BIGINT NOT NULL,
    command VARCHAR(100) NOT NULL,
    payload VARCHAR(255) UNIQUE NOT NULL,
    invoice_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    status VARCHAR(50) DEFAULT 'pending'
);

CREATE INDEX idx_pending_payments_payload ON pending_payments(payload);
CREATE INDEX idx_pending_payments_status ON pending_payments(status);
CREATE INDEX idx_pending_payments_expires_at ON pending_payments(expires_at);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    telegram_payment_charge_id VARCHAR(255) UNIQUE NOT NULL,
    telegram_user_id BIGINT NOT NULL,
    chat_id BIGINT NOT NULL,
    amount INTEGER NOT NULL,
    currency VARCHAR(10) DEFAULT 'XTR',
    payload VARCHAR(255),
    status VARCHAR(50) DEFAULT 'completed',
    pending_payment_id INTEGER REFERENCES pending_payments(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payments_charge_id ON payments(telegram_payment_charge_id);
CREATE INDEX idx_payments_user ON payments(telegram_user_id);

-- Behavior Profiles table
CREATE TABLE IF NOT EXISTS behavior_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
    attack_count INTEGER DEFAULT 0,
    defend_count INTEGER DEFAULT 0,
    total_actions INTEGER DEFAULT 0,
    attack_rate DECIMAL(5,2) DEFAULT 0,
    defend_rate DECIMAL(5,2) DEFAULT 0,
    aggression DECIMAL(5,2) DEFAULT 50,
    predictability DECIMAL(5,2) DEFAULT 50,
    recent_actions JSONB DEFAULT '[]',
    after_big_damage VARCHAR(50),
    common_sequences JSONB DEFAULT '[]',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chat_id, season_id)
);

CREATE INDEX idx_behavior_profiles_user_chat ON behavior_profiles(user_id, chat_id);

-- Combat Logs table
CREATE TABLE IF NOT EXISTS combat_logs (
    id SERIAL PRIMARY KEY,
    player_progress_id INTEGER REFERENCES player_progress(id) ON DELETE CASCADE,
    floor INTEGER NOT NULL,
    enemy_id INTEGER REFERENCES enemies(id),
    player_action VARCHAR(50),
    enemy_action VARCHAR(50),
    player_damage INTEGER DEFAULT 0,
    enemy_damage INTEGER DEFAULT 0,
    player_hp_after INTEGER,
    enemy_hp_after INTEGER,
    is_victory BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_combat_logs_player ON combat_logs(player_progress_id);
CREATE INDEX idx_combat_logs_floor ON combat_logs(floor);

-- Leaderboards table
CREATE TABLE IF NOT EXISTS leaderboards (
    id SERIAL PRIMARY KEY,
    season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    floor_reached INTEGER NOT NULL,
    class_id INTEGER REFERENCES classes(id),
    total_time_seconds INTEGER,
    bosses_defeated INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(season_id, user_id, chat_id)
);

CREATE INDEX idx_leaderboards_season_floor ON leaderboards(season_id, floor_reached DESC);
