-- Migration 018: Fix combat state to be per-chat instead of per-user
-- This ensures each chat has its own separate enemy and combat doesn't sync between chats

BEGIN;

-- Step 1: Drop old unique constraint
ALTER TABLE combat_state DROP CONSTRAINT IF EXISTS combat_state_user_id_season_id_key;

-- Step 2: Add chat_id column (nullable initially for migration)
ALTER TABLE combat_state ADD COLUMN IF NOT EXISTS chat_id INTEGER;

-- Step 3: Delete all existing combat states (they're invalid without chat_id)
DELETE FROM combat_state;

-- Step 4: Make chat_id NOT NULL and add foreign key
ALTER TABLE combat_state ALTER COLUMN chat_id SET NOT NULL;
ALTER TABLE combat_state ADD CONSTRAINT combat_state_chat_id_fkey 
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE;

-- Step 5: Add new unique constraint for user, season, AND chat
ALTER TABLE combat_state ADD CONSTRAINT combat_state_user_season_chat_key 
    UNIQUE(user_id, season_id, chat_id);

-- Step 6: Update index
DROP INDEX IF EXISTS idx_combat_state_user_season;
CREATE INDEX idx_combat_state_user_season_chat ON combat_state(user_id, season_id, chat_id);

COMMIT;
