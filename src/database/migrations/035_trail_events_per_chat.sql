-- Trail events are scoped to the chat they were created in: a door choice
-- offered in one chat must not block combat actions in another chat.

ALTER TABLE trail_events
  DROP CONSTRAINT IF EXISTS trail_events_user_id_season_id_key;

ALTER TABLE trail_events
  ADD CONSTRAINT trail_events_user_season_chat_key UNIQUE (user_id, season_id, chat_id);

DROP INDEX IF EXISTS idx_trail_events_user_season;

CREATE INDEX IF NOT EXISTS idx_trail_events_user_season_chat
  ON trail_events(user_id, season_id, chat_id);
