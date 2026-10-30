-- Trail (path choice) events now record which Telegram user owns them, so the
-- direction buttons can only be pressed by that player. Rows created before
-- this migration keep NULL here and are treated as legacy (auto-resolved once).
ALTER TABLE trail_events
  ADD COLUMN IF NOT EXISTS owner_telegram_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_trail_events_owner_telegram
  ON trail_events(owner_telegram_id);
