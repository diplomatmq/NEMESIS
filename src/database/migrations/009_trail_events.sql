CREATE TABLE IF NOT EXISTS trail_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    floor INTEGER NOT NULL,
    options JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, season_id)
);

CREATE INDEX IF NOT EXISTS idx_trail_events_user_season
  ON trail_events(user_id, season_id);

ALTER TABLE player_progress
  ADD COLUMN IF NOT EXISTS trail_modifier NUMERIC(4,2) DEFAULT 1;

CREATE TABLE IF NOT EXISTS trail_markets (
    id SERIAL PRIMARY KEY,
    player_progress_id INTEGER NOT NULL REFERENCES player_progress(id) ON DELETE CASCADE,
    offers JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
