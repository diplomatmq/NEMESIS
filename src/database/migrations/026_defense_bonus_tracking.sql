-- Migration 026: Add defense bonus tracking to combat state
-- This allows storing defense bonuses between turns for proper balance

BEGIN;

-- Add fields to track defense bonuses between turns
ALTER TABLE combat_state ADD COLUMN IF NOT EXISTS stored_defense_bonus INTEGER DEFAULT 0;
ALTER TABLE combat_state ADD COLUMN IF NOT EXISTS total_boss_healing INTEGER DEFAULT 0;
ALTER TABLE combat_state ADD COLUMN IF NOT EXISTS last_heal_turn INTEGER DEFAULT 0;

COMMIT;
