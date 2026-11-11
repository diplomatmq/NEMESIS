-- Migration 044: Mini App (Emberspire) Tables
-- Creates tables for the mini-application with 'app_' prefix to avoid conflicts
-- These tables are used by the Python mini-app server (app/ebashnya)

-- Mini app players (separate from main game players)
CREATE TABLE IF NOT EXISTS app_players (
    id BIGINT PRIMARY KEY,                    -- Telegram user ID
    name TEXT,
    username TEXT,
    cls TEXT,                                  -- Class in mini app
    room INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    kills INTEGER DEFAULT 0,
    bosses INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    first_seen TIMESTAMP,
    updated TIMESTAMP,
    reached TIMESTAMP,
    flagged INTEGER DEFAULT 0,
    ref_by BIGINT,                            -- Referrer ID
    welcomed INTEGER DEFAULT 0,
    ref_paid INTEGER DEFAULT 0,
    notify INTEGER DEFAULT 0,
    rest_at TIMESTAMP,
    reminded TIMESTAMP,
    seen TIMESTAMP,
    notify_off INTEGER DEFAULT 0,
    can_pm INTEGER DEFAULT 0,
    wipe_at TIMESTAMP,
    dtag TEXT,                                -- Player tag
    stars INTEGER DEFAULT 0,                  -- Star currency
    skips INTEGER DEFAULT 0,                  -- Skip count
    class_changes INTEGER DEFAULT 0,          -- Class change count
    autofarm INTEGER DEFAULT 0,               -- Autofarm enabled
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_players_room ON app_players(flagged, room DESC, reached ASC);
CREATE INDEX IF NOT EXISTS idx_app_players_ref ON app_players(ref_by);
CREATE INDEX IF NOT EXISTS idx_app_players_rest ON app_players(rest_at);

-- Daily activity tracking
CREATE TABLE IF NOT EXISTS app_activity (
    day INTEGER NOT NULL,
    uid BIGINT NOT NULL,
    PRIMARY KEY(day, uid)
);

-- Fight logs for analytics
CREATE TABLE IF NOT EXISTS app_fight_log (
    id BIGSERIAL PRIMARY KEY,
    uid BIGINT NOT NULL,
    ts TIMESTAMP NOT NULL,
    room INTEGER,
    kind TEXT,
    win INTEGER,
    tries INTEGER,
    dur INTEGER,
    cls TEXT,
    level INTEGER,
    hp INTEGER,
    atk INTEGER,
    df INTEGER,
    q INTEGER,
    auto INTEGER
);

CREATE INDEX IF NOT EXISTS idx_app_fight_log_ts ON app_fight_log(ts);
CREATE INDEX IF NOT EXISTS idx_app_fight_log_uid ON app_fight_log(uid);

-- Referral hits (daily tracking)
CREATE TABLE IF NOT EXISTS app_ref_hits (
    inviter BIGINT NOT NULL,
    visitor BIGINT NOT NULL,
    day INTEGER NOT NULL,
    PRIMARY KEY(inviter, visitor, day)
);

-- Chat raids
CREATE TABLE IF NOT EXISTS app_raids (
    ci TEXT NOT NULL,                         -- Chat instance
    week INTEGER NOT NULL,
    max_hp INTEGER,
    hp INTEGER,
    killed TIMESTAMP,
    lvl INTEGER DEFAULT 1,
    PRIMARY KEY(ci, week)
);

-- Raid hits
CREATE TABLE IF NOT EXISTS app_raid_hits (
    ci TEXT NOT NULL,
    week INTEGER NOT NULL,
    uid BIGINT NOT NULL,
    dmg INTEGER DEFAULT 0,
    claimed INTEGER DEFAULT 0,
    PRIMARY KEY(ci, week, uid)
);

-- Cloud saves
CREATE TABLE IF NOT EXISTS app_saves (
    uid BIGINT PRIMARY KEY,
    data TEXT,                                -- JSON save data
    score REAL,
    ts TIMESTAMP
);

-- Raid events (admin-created)
CREATE TABLE IF NOT EXISTS app_raid_events (
    ci TEXT PRIMARY KEY,
    chat_id BIGINT NOT NULL,
    by_uid BIGINT NOT NULL,
    ends TIMESTAMP NOT NULL,
    lvl INTEGER DEFAULT 1,
    closed INTEGER DEFAULT 0,
    title TEXT,
    boss TEXT
);

-- Raid tries per chat (daily limit)
CREATE TABLE IF NOT EXISTS app_raid_tries_chat (
    uid BIGINT NOT NULL,
    ci TEXT NOT NULL,
    day INTEGER NOT NULL,
    n INTEGER DEFAULT 0,
    last TIMESTAMP,
    PRIMARY KEY(uid, ci, day)
);

-- Raid statistics per player per chat
CREATE TABLE IF NOT EXISTS app_raid_stats (
    uid BIGINT NOT NULL,
    ci TEXT NOT NULL,
    dmg INTEGER DEFAULT 0,
    best INTEGER DEFAULT 0,
    hits INTEGER DEFAULT 0,
    PRIMARY KEY(uid, ci)
);

-- Raid chats (for numbering)
CREATE TABLE IF NOT EXISTS app_raid_chats (
    ci TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Raid tries (global daily limit)
CREATE TABLE IF NOT EXISTS app_raid_tries (
    uid BIGINT NOT NULL,
    day INTEGER NOT NULL,
    n INTEGER DEFAULT 0,
    last TIMESTAMP,
    PRIMARY KEY(uid, day)
);

-- Key-value store
CREATE TABLE IF NOT EXISTS app_kv (
    k TEXT PRIMARY KEY,
    v TEXT
);

-- Duels
CREATE TABLE IF NOT EXISTS app_duels (
    id TEXT PRIMARY KEY,
    from_uid BIGINT NOT NULL,
    to_uid BIGINT,
    from_name TEXT,
    to_name TEXT,
    from_cls TEXT,
    to_cls TEXT,
    from_room INTEGER,
    to_room INTEGER,
    created TIMESTAMP NOT NULL,
    fought TIMESTAMP,
    done_at TIMESTAMP,  -- Alias for fought (compatibility)
    winner BIGINT,
    replay TEXT,                              -- JSON replay data
    public INTEGER DEFAULT 0,
    kind TEXT,                                -- Type of duel: 'direct', etc.
    result TEXT,                              -- Result data
    from_claimed INTEGER DEFAULT 0,           -- Whether rewards claimed
    declined INTEGER DEFAULT 0,               -- Whether duel was declined
    from_snap TEXT,                           -- Snapshot of from player state
    to_snap TEXT                              -- Snapshot of to player state
);

CREATE INDEX IF NOT EXISTS idx_app_duels_from ON app_duels(from_uid);
CREATE INDEX IF NOT EXISTS idx_app_duels_to ON app_duels(to_uid);
CREATE INDEX IF NOT EXISTS idx_app_duels_created ON app_duels(created DESC);
CREATE INDEX IF NOT EXISTS idx_app_duels_done_at ON app_duels(to_uid, done_at);

-- Quests (daily/weekly)
CREATE TABLE IF NOT EXISTS app_quests (
    uid BIGINT NOT NULL,
    day INTEGER NOT NULL,
    quest_id TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    claimed INTEGER DEFAULT 0,
    PRIMARY KEY(uid, day, quest_id)
);

-- Star purchases (mini app has its own economy)
CREATE TABLE IF NOT EXISTS app_star_ledger (
    id BIGSERIAL PRIMARY KEY,
    uid BIGINT NOT NULL,
    delta INTEGER NOT NULL,                   -- Stars change (+/-)
    what TEXT NOT NULL,                       -- Purchase type
    n INTEGER DEFAULT 0,                      -- Quantity
    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_star_ledger_uid ON app_star_ledger(uid);

-- Group lobby for multiplayer
CREATE TABLE IF NOT EXISTS app_gr_lobby (
    id TEXT PRIMARY KEY,
    host BIGINT NOT NULL,
    created TIMESTAMP NOT NULL,
    public INTEGER DEFAULT 0,                 -- Open to anyone
    data TEXT                                 -- JSON lobby data
);

CREATE INDEX IF NOT EXISTS idx_app_gr_lobby_host ON app_gr_lobby(host, created);

-- NFT drops
CREATE TABLE IF NOT EXISTS app_nft_drops (
    id TEXT PRIMARY KEY,
    uid BIGINT NOT NULL,
    kind TEXT,
    name TEXT,                                -- NFT name
    room INTEGER,                             -- Room where it dropped
    ts TIMESTAMP,
    status TEXT DEFAULT 'new',
    req_ts TIMESTAMP,
    done_ts TIMESTAMP,
    link TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_nft_drops_uid ON app_nft_drops(uid);

-- Group claims (for daily rewards)
CREATE TABLE IF NOT EXISTS app_gr_claims (
    uid BIGINT NOT NULL,
    day INTEGER NOT NULL,
    b INTEGER NOT NULL,                       -- Boss number
    PRIMARY KEY(uid, day, b)
);

-- Activity tracking (already exists as app_activity, but code references app_act)
CREATE TABLE IF NOT EXISTS app_act (
    day INTEGER NOT NULL,
    uid BIGINT NOT NULL,
    PRIMARY KEY(day, uid)
);

-- Comments for documentation
COMMENT ON TABLE app_players IS 'Mini app player profiles (separate from main game)';
COMMENT ON TABLE app_raids IS 'Weekly chat raids in mini app';
COMMENT ON TABLE app_saves IS 'Cloud saves for mini app game progress';
COMMENT ON TABLE app_duels IS 'PvP duels between players';
COMMENT ON TABLE app_star_ledger IS 'Star economy transactions for mini app';

-- Activity tracking (daily unique players)
CREATE TABLE IF NOT EXISTS app_act (
    day INTEGER NOT NULL,
    uid BIGINT NOT NULL,
    PRIMARY KEY(day, uid)
);

-- Raid tries per chat (renamed from raid_tries_c)
-- Already exists as app_raid_tries_chat, but some code may reference old name
