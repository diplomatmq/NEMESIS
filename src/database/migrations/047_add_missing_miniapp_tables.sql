-- Migration 047: Add missing miniapp tables (sessions, ghost_offers) and columns

-- Sessions table (for game session tracking)
CREATE TABLE IF NOT EXISTS app_sessions (
    uid BIGINT PRIMARY KEY,
    sid TEXT,
    dev TEXT,
    ts BIGINT  -- Unix timestamp
);

-- Ghost offers table (for PvE ghost opponents)
CREATE TABLE IF NOT EXISTS app_ghost_offers (
    uid BIGINT NOT NULL,
    gid BIGINT NOT NULL,
    ts BIGINT,  -- Unix timestamp
    room INTEGER,
    PRIMARY KEY(uid, gid)
);

-- Add missing columns to app_gr_lobby
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'app_gr_lobby' AND column_name = 'status') THEN
        ALTER TABLE app_gr_lobby ADD COLUMN status TEXT DEFAULT 'open';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'app_gr_lobby' AND column_name = 'members') THEN
        ALTER TABLE app_gr_lobby ADD COLUMN members TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'app_gr_lobby' AND column_name = 'result') THEN
        ALTER TABLE app_gr_lobby ADD COLUMN result TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'app_gr_lobby' AND column_name = 'done_at') THEN
        ALTER TABLE app_gr_lobby ADD COLUMN done_at BIGINT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'app_gr_lobby' AND column_name = 'b') THEN
        ALTER TABLE app_gr_lobby ADD COLUMN b INTEGER;
    END IF;
END $$;

COMMENT ON TABLE app_sessions IS 'Game sessions with unix timestamps';
COMMENT ON TABLE app_ghost_offers IS 'PvE ghost opponent offers';
