-- Migration 046: Fix timestamp columns that should be BIGINT
-- Several tables use 'ts' to store unix timestamps as numbers, not PostgreSQL timestamps

-- Fix app_saves.ts
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'app_saves' 
        AND column_name = 'ts' 
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    ) THEN
        DROP TABLE IF EXISTS app_saves CASCADE;
        
        CREATE TABLE app_saves (
            uid BIGINT PRIMARY KEY,
            data TEXT,
            score DOUBLE PRECISION,
            ts BIGINT
        );
    END IF;
END $$;

-- Fix app_fight_log.ts
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'app_fight_log' 
        AND column_name = 'ts' 
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    ) THEN
        ALTER TABLE app_fight_log ALTER COLUMN ts TYPE BIGINT USING EXTRACT(EPOCH FROM ts)::BIGINT;
    END IF;
END $$;

-- Fix app_nft_drops timestamp columns
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'app_nft_drops' 
        AND column_name = 'ts' 
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    ) THEN
        ALTER TABLE app_nft_drops 
            ALTER COLUMN ts TYPE BIGINT USING EXTRACT(EPOCH FROM ts)::BIGINT,
            ALTER COLUMN req_ts TYPE BIGINT USING EXTRACT(EPOCH FROM req_ts)::BIGINT,
            ALTER COLUMN done_ts TYPE BIGINT USING EXTRACT(EPOCH FROM done_ts)::BIGINT;
    END IF;
END $$;

-- Create missing app_raid_tries_chat table (renamed from app_raid_tries_c)
CREATE TABLE IF NOT EXISTS app_raid_tries_chat (
    uid BIGINT NOT NULL,
    ci TEXT NOT NULL,
    day INTEGER NOT NULL,
    n INTEGER DEFAULT 0,
    last BIGINT DEFAULT 0,
    PRIMARY KEY(uid, ci, day)
);

COMMENT ON TABLE app_saves IS 'Cloud saves with unix timestamps';
COMMENT ON TABLE app_fight_log IS 'Fight logs with unix timestamps';
COMMENT ON TABLE app_nft_drops IS 'NFT drops with unix timestamps';
