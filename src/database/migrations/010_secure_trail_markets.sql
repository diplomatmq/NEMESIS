ALTER TABLE trail_markets
  ADD COLUMN IF NOT EXISTS chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE;

UPDATE trail_markets
SET chat_id = (
  SELECT chat_id
  FROM trail_events
  WHERE trail_events.user_id = (
    SELECT u.id
    FROM users u
    JOIN player_progress pp ON pp.user_id = u.id
    WHERE pp.id = trail_markets.player_progress_id
  )
  ORDER BY trail_events.created_at DESC
  LIMIT 1
)
WHERE chat_id IS NULL;

DELETE FROM trail_markets WHERE chat_id IS NULL;

ALTER TABLE trail_markets
  ALTER COLUMN chat_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trail_markets_progress_chat
  ON trail_markets(player_progress_id, chat_id);
