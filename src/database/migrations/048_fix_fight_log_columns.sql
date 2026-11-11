-- Migration 048: Fix app_fight_log schema to match SQLite code
-- Remove id BIGSERIAL column that causes INSERT mismatch

-- Drop and recreate app_fight_log without id column
DROP TABLE IF EXISTS app_fight_log CASCADE;

CREATE TABLE app_fight_log (
    uid BIGINT NOT NULL,
    ts BIGINT NOT NULL,                       -- Unix timestamp
    room INTEGER,
    kind TEXT,
    win INTEGER,
    tries INTEGER,
    dur INTEGER,
    cls TEXT,
    level INTEGER,
    hp INTEGER,
    atk INTEGER,
    df INTEGER,
    q INTEGER,
    auto INTEGER
);

CREATE INDEX IF NOT EXISTS idx_app_fight_log_ts ON app_fight_log(ts);
CREATE INDEX IF NOT EXISTS idx_app_fight_log_uid ON app_fight_log(uid);

COMMENT ON TABLE app_fight_log IS 'Fight logs for analytics (no primary key to match SQLite schema)';
