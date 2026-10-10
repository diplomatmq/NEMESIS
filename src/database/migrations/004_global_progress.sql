-- Migration: Global Player Progress and Combat State
-- This migration makes player progress independent of chat_id
-- and adds combat state tracking across chats

-- SAFETY CHECK: Only run if not already applied
DO $$
BEGIN
    -- If migration already applied, skip everything
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'player_progress_old'
    ) THEN
        RAISE NOTICE 'Migration 004 already applied (player_progress_old exists), skipping...';
        RETURN;
    END IF;

    -- If player_progress doesn't exist yet, also skip (will be created by 001)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'player_progress'
    ) THEN
        RAISE NOTICE 'Migration 004 skipped (player_progress does not exist yet)';
        RETURN;
    END IF;

    RAISE NOTICE 'Running migration 004: Global Player Progress...';

    -- Step 1: Create new global player progress table
    CREATE TABLE IF NOT EXISTS player_progress_global (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, season_id)
    );

    CREATE INDEX IF NOT EXISTS idx_player_progress_global_user_season ON player_progress_global(user_id, season_id);
    CREATE INDEX IF NOT EXISTS idx_player_progress_global_floor ON player_progress_global(floor);

    -- Step 2: Create combat state table to track current enemy
    CREATE TABLE IF NOT EXISTS combat_state (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
        floor INTEGER NOT NULL,
        enemy_data JSONB NOT NULL,
        player_hp_before INTEGER NOT NULL,
        rounds_completed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, season_id)
    );

    CREATE INDEX IF NOT EXISTS idx_combat_state_user_season ON combat_state(user_id, season_id);

    -- Step 3: Create chat progress tracking (for rewards reduction)
    CREATE TABLE IF NOT EXISTS chat_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
        season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
        current_floor INTEGER DEFAULT 1,
        highest_floor_reached INTEGER DEFAULT 1,
        is_primary_chat BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, chat_id, season_id)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_progress_user_chat_season ON chat_progress(user_id, chat_id, season_id);

    -- Step 4: Migrate existing data from player_progress to new structure
    INSERT INTO player_progress_global (user_id, season_id, class_id, floor, hp, max_hp, attack, defense, gold, xp, level, checkpoint_floor, created_at, updated_at)
    SELECT 
        user_id,
        season_id,
        class_id,
        MAX(floor) as floor,
        MAX(hp) as hp,
        MAX(max_hp) as max_hp,
        MAX(attack) as attack,
        MAX(defense) as defense,
        SUM(gold) as gold,
        SUM(xp) as xp,
        MAX(level) as level,
        MAX(checkpoint_floor) as checkpoint_floor,
        MIN(created_at) as created_at,
        MAX(updated_at) as updated_at
    FROM player_progress
    GROUP BY user_id, season_id, class_id
    ON CONFLICT (user_id, season_id) DO NOTHING;

    -- Step 5: Create chat progress entries from existing player_progress
    INSERT INTO chat_progress (user_id, chat_id, season_id, current_floor, highest_floor_reached, is_primary_chat, created_at, updated_at)
    SELECT 
        pp.user_id,
        pp.chat_id,
        pp.season_id,
        pp.floor as current_floor,
        pp.floor as highest_floor_reached,
        true as is_primary_chat,
        pp.created_at,
        pp.updated_at
    FROM player_progress pp
    ON CONFLICT (user_id, chat_id, season_id) DO NOTHING;

    -- Step 6: Update cooldowns table to be user-global (remove chat_id dependency)
    -- First, keep only the most recent cooldown per user
    DELETE FROM cooldowns c1
    WHERE id NOT IN (
        SELECT id FROM (
            SELECT DISTINCT ON (user_id, action_type) id
            FROM cooldowns
            ORDER BY user_id, action_type, created_at DESC
        ) AS c2
    );

    -- Then drop the old unique constraint and add new one
    ALTER TABLE cooldowns DROP CONSTRAINT IF EXISTS cooldowns_user_id_chat_id_action_type_key;
    ALTER TABLE cooldowns ADD CONSTRAINT cooldowns_user_id_action_type_key UNIQUE(user_id, action_type);

    -- Step 7: Update behavior_profiles to be user-global
    ALTER TABLE behavior_profiles DROP CONSTRAINT IF EXISTS behavior_profiles_user_id_chat_id_season_id_key;
    ALTER TABLE behavior_profiles ADD CONSTRAINT behavior_profiles_user_id_season_id_key UNIQUE(user_id, season_id);

    -- Step 8: Rename old table (keep for safety)
    ALTER TABLE player_progress RENAME TO player_progress_old;

    -- Step 9: Rename new table to player_progress
    ALTER TABLE player_progress_global RENAME TO player_progress;

    -- Step 10: Drop old foreign keys from related tables
    ALTER TABLE player_inventory DROP CONSTRAINT IF EXISTS player_inventory_player_progress_id_fkey;
    ALTER TABLE player_equipment DROP CONSTRAINT IF EXISTS player_equipment_player_progress_id_fkey;
    ALTER TABLE combat_logs DROP CONSTRAINT IF EXISTS combat_logs_player_progress_id_fkey;

    RAISE NOTICE 'Migration 004 completed successfully';
END $$;
