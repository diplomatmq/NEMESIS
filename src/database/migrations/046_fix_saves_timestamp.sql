-- Migration 046: Fix app_saves.ts column type
-- The ts column should store unix timestamps as BIGINT, not TIMESTAMP

-- Change ts column from TIMESTAMP to BIGINT for unix timestamp storage
DO $$ 
BEGIN
    -- Check if column exists and is TIMESTAMP type
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'app_saves' 
        AND column_name = 'ts' 
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    ) THEN
        -- Drop and recreate with correct type
        -- First save any existing data
        CREATE TEMP TABLE IF NOT EXISTS temp_saves AS 
        SELECT uid, data, score FROM app_saves;
        
        -- Drop the table and recreate with correct type
        DROP TABLE IF EXISTS app_saves CASCADE;
        
        CREATE TABLE app_saves (
            uid BIGINT PRIMARY KEY,
            data TEXT,
            score DOUBLE PRECISION,
            ts BIGINT  -- Unix timestamp as number
        );
        
        -- Restore data (without ts since it was corrupted)
        INSERT INTO app_saves (uid, data, score, ts)
        SELECT uid, data, score, NULL
        FROM temp_saves
        ON CONFLICT (uid) DO NOTHING;
        
        DROP TABLE IF EXISTS temp_saves;
    END IF;
END $$;

COMMENT ON COLUMN app_saves.ts IS 'Unix timestamp (seconds since epoch)';
