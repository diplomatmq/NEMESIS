-- Slot machine sessions table
-- Tracks active slot sessions for users

CREATE TABLE IF NOT EXISTS slot_sessions (
  id SERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  spins_paid INTEGER NOT NULL,
  spins_remaining INTEGER NOT NULL,
  stars_paid INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  
  CONSTRAINT slot_sessions_spins_positive CHECK (spins_paid > 0),
  CONSTRAINT slot_sessions_remaining_valid CHECK (spins_remaining >= 0 AND spins_remaining <= spins_paid)
);

CREATE INDEX idx_slot_sessions_user_status ON slot_sessions(telegram_user_id, status);
CREATE INDEX idx_slot_sessions_expires ON slot_sessions(expires_at);
