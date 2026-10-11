-- Payment statistics table
-- Tracks all successful star payments for analytics

CREATE TABLE IF NOT EXISTS payment_stats (
  id SERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  stars_amount INTEGER NOT NULL,
  payment_date TIMESTAMP DEFAULT NOW(),
  telegram_payment_charge_id TEXT UNIQUE NOT NULL,
  
  CONSTRAINT payment_stats_stars_positive CHECK (stars_amount > 0)
);

CREATE INDEX idx_payment_stats_user ON payment_stats(telegram_user_id);
CREATE INDEX idx_payment_stats_date ON payment_stats(payment_date);
