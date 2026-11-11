-- Migration 045: Add missing columns to mini app tables
-- Adds name, room, from_snap, to_snap columns that were missing from initial migration

-- Add name and room columns to app_nft_drops if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'app_nft_drops' AND column_name = 'name') THEN
        ALTER TABLE app_nft_drops ADD COLUMN name TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'app_nft_drops' AND column_name = 'room') THEN
        ALTER TABLE app_nft_drops ADD COLUMN room INTEGER;
    END IF;
END $$;

-- Add from_snap and to_snap columns to app_duels if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'app_duels' AND column_name = 'from_snap') THEN
        ALTER TABLE app_duels ADD COLUMN from_snap TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'app_duels' AND column_name = 'to_snap') THEN
        ALTER TABLE app_duels ADD COLUMN to_snap TEXT;
    END IF;
END $$;

-- Create app_gr_claims table if it doesn't exist
CREATE TABLE IF NOT EXISTS app_gr_claims (
    uid BIGINT NOT NULL,
    day INTEGER NOT NULL,
    b INTEGER NOT NULL,
    PRIMARY KEY(uid, day, b)
);

COMMENT ON TABLE app_gr_claims IS 'Group claims for daily rewards in mini app';
