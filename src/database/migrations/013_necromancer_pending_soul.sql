-- Add pending soul field for necromancer when both boss slots are full
ALTER TABLE player_progress
  ADD COLUMN IF NOT EXISTS necro_pending_soul JSONB NULL;

COMMENT ON COLUMN player_progress.necro_pending_soul IS 'Temporary storage for a boss soul when both slots are full, waiting for player decision';
