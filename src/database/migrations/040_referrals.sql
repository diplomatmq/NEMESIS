-- Referral program: a chat owner receives a share of the stars spent inside their chat.

CREATE TABLE IF NOT EXISTS referral_chats (
    id SERIAL PRIMARY KEY,
    owner_telegram_id BIGINT NOT NULL,
    chat_telegram_id BIGINT NOT NULL UNIQUE,
    percent NUMERIC(5,2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT referral_chats_percent_valid CHECK (percent > 0 AND percent <= 100)
);

CREATE INDEX IF NOT EXISTS idx_referral_chats_owner ON referral_chats(owner_telegram_id);

CREATE TABLE IF NOT EXISTS referral_withdrawals (
    id SERIAL PRIMARY KEY,
    referral_chat_id INTEGER NOT NULL REFERENCES referral_chats(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,

    CONSTRAINT referral_withdrawals_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_referral_withdrawals_chat ON referral_withdrawals(referral_chat_id, status);
