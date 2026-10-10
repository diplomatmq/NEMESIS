-- Create migrations tracking table
-- This table keeps track of which migrations have been applied
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    checksum VARCHAR(64), -- Optional: for verifying migration hasn't changed
    execution_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_name ON schema_migrations(migration_name);

-- Insert this migration itself if not exists
INSERT INTO schema_migrations (migration_name, applied_at)
VALUES ('000_migrations_table', CURRENT_TIMESTAMP)
ON CONFLICT (migration_name) DO NOTHING;
