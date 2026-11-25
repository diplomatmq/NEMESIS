-- Migration 051: Telegram ids in the mini app get 64 bits
-- A Telegram id is past 2^31 now (e.g. 6078701333), but PostgreSQL's INTEGER ends at 2 147 483 647.
-- The mini-app tables are first created by server.py with INTEGER id columns; the later migrations only
-- say CREATE TABLE IF NOT EXISTS, so on a database that already had them the BIGINT declaration was a no-op
-- and the columns stayed 32-bit. Writing such an id then failed with «integer out of range»: e.g. the
-- ref_hits insert in the invite/duel flow threw, the request aborted and the inviter never got the friend.
-- (v270 patched raid_hits/raid_stats the same way; ref_hits and the other id columns were left behind.)
-- The block is idempotent: it skips missing tables/columns and leaves anything already BIGINT untouched.

DO $$
DECLARE
    t text;
    c text;
    ty text;
    pairs text[][] := ARRAY[
        ['app_players',         'id'],
        ['app_players',         'ref_by'],
        ['app_act',             'uid'],
        ['app_activity',        'uid'],
        ['app_fight_log',       'uid'],
        ['app_ref_hits',        'inviter'],
        ['app_ref_hits',        'visitor'],
        ['app_saves',           'uid'],
        ['app_raid_hits',       'uid'],
        ['app_raid_stats',      'uid'],
        ['app_raid_tries',      'uid'],
        ['app_raid_tries_c',    'uid'],
        ['app_raid_tries_chat', 'uid'],
        ['app_raid_events',     'chat_id'],
        ['app_raid_events',     'by_uid'],
        ['app_duels',           'from_uid'],
        ['app_duels',           'to_uid'],
        ['app_duels',           'winner'],
        ['app_duel_paid',       'uid'],
        ['app_sessions',        'uid'],
        ['app_ghost_offers',    'uid'],
        ['app_ghost_offers',    'gid'],
        ['app_quest_claims',    'uid'],
        ['app_quests',          'uid'],
        ['app_star_ledger',     'uid'],
        ['app_star_pay',        'uid'],
        ['app_gr_lobby',        'host'],
        ['app_gr_claims',       'uid'],
        ['app_nft_drops',       'uid']
    ];
    i int;
BEGIN
    FOR i IN 1 .. array_length(pairs, 1) LOOP
        t := pairs[i][1];
        c := pairs[i][2];

        IF to_regclass('public.' || t) IS NULL THEN
            CONTINUE;
        END IF;

        SELECT data_type INTO ty
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = t AND column_name = c;

        IF ty IS NULL OR ty = 'bigint' THEN
            CONTINUE;
        END IF;

        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE BIGINT', t, c);
    END LOOP;
END $$;
