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

-- Fix app_star_ledger.ts
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'app_star_ledger' 
        AND column_name = 'ts' 
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    ) THEN
        -- Drop DEFAULT first, then change type
        ALTER TABLE app_star_ledger ALTER COLUMN ts DROP DEFAULT;
        ALTER TABLE app_star_ledger ALTER COLUMN ts TYPE BIGINT USING EXTRACT(EPOCH FROM ts)::BIGINT;
    END IF;
END $$;

-- Create missing app_raid_tries_chat table (renamed from app_raid_tries_c)
-- Note: 'last' stores unix timestamp as DOUBLE PRECISION (REAL in SQLite)
CREATE TABLE IF NOT EXISTS app_raid_tries_chat (
    uid BIGINT NOT NULL,
    ci TEXT NOT NULL,
    day INTEGER NOT NULL,
    n INTEGER DEFAULT 0,
    last DOUBLE PRECISION DEFAULT 0,
    PRIMARY KEY(uid, ci, day)
);

-- Also create app_raid_tries_c as alias (some code references this name)
CREATE TABLE IF NOT EXISTS app_raid_tries_c (
    uid BIGINT NOT NULL,
    ci TEXT NOT NULL,
    day INTEGER NOT NULL,
    n INTEGER DEFAULT 0,
    last DOUBLE PRECISION DEFAULT 0,
    PRIMARY KEY(uid, ci, day)
);

-- Fix app_raid_tries.last to be DOUBLE PRECISION (unix timestamp)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'app_raid_tries' 
        AND column_name = 'last' 
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    ) THEN
        ALTER TABLE app_raid_tries 
            ALTER COLUMN last TYPE DOUBLE PRECISION USING EXTRACT(EPOCH FROM last);
    END IF;
END $$;

-- Fix app_gr_lobby.created and done_at to be DOUBLE PRECISION (unix timestamp)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'app_gr_lobby' 
        AND column_name = 'created' 
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    ) THEN
        ALTER TABLE app_gr_lobby 
            ALTER COLUMN created TYPE DOUBLE PRECISION USING EXTRACT(EPOCH FROM created);
    END IF;
END $$;

-- Fix app_raids.killed to be DOUBLE PRECISION (unix timestamp)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'app_raids' 
        AND column_name = 'killed' 
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    ) THEN
        ALTER TABLE app_raids 
            ALTER COLUMN killed TYPE DOUBLE PRECISION USING EXTRACT(EPOCH FROM killed);
    END IF;
END $$;

-- Fix app_raid_events.ends to be DOUBLE PRECISION (unix timestamp)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'app_raid_events' 
        AND column_name = 'ends' 
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    ) THEN
        ALTER TABLE app_raid_events 
            ALTER COLUMN ends TYPE DOUBLE PRECISION USING EXTRACT(EPOCH FROM ends);
    END IF;
END $$;

-- Fix app_duels timestamp columns to be DOUBLE PRECISION (unix timestamps)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'app_duels' 
        AND column_name = 'created' 
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    ) THEN
        ALTER TABLE app_duels 
            ALTER COLUMN created TYPE DOUBLE PRECISION USING EXTRACT(EPOCH FROM created),
            ALTER COLUMN fought TYPE DOUBLE PRECISION USING EXTRACT(EPOCH FROM fought),
            ALTER COLUMN done_at TYPE DOUBLE PRECISION USING EXTRACT(EPOCH FROM done_at);
    END IF;
END $$;

COMMENT ON TABLE app_saves IS 'Cloud saves with unix timestamps';
COMMENT ON TABLE app_fight_log IS 'Fight logs with unix timestamps';
COMMENT ON TABLE app_nft_drops IS 'NFT drops with unix timestamps';
