-- Player bans issued by administrators through /ban.
--
-- A NULL `banned_until` marks a permanent block, so a single timestamp column
-- covers both temporary and endless bans. One row per player: banning someone
-- again replaces the previous reason and end date instead of piling up rows,
-- which keeps the public /goblins list readable.
CREATE TABLE IF NOT EXISTS player_bans (
    telegram_id BIGINT PRIMARY KEY,
    username VARCHAR(255),
    first_name VARCHAR(255),
    reason TEXT,
    banned_by BIGINT NOT NULL,
    banned_until TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Expired rows are ignored by every query, the index keeps the active-lookup
-- path cheap for the ban check that runs on each gameplay update.
CREATE INDEX IF NOT EXISTS idx_player_bans_until ON player_bans(banned_until);
