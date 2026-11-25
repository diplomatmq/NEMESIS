-- Migration 050: Damage columns get 64 bits
-- PostgreSQL's INTEGER tops out at 2 147 483 647, while SQLite's INTEGER is already 64-bit.
-- Strong heroes hit for billions now, so stored damage/combat HP overflowed INTEGER and the write failed.
-- Here every damage/hp column that stores fight results or chat-boss numbers is widened to BIGINT.
-- The block is idempotent: it skips missing tables/columns and leaves columns that are already BIGINT untouched.

DO $$
DECLARE
    t text;
    c text;
    ty text;
    pairs text[][] := ARRAY[
        -- fight damage (main bot combat log)
        ['combat_logs',    'player_damage'],
        ['combat_logs',    'enemy_damage'],
        ['combat_logs',    'player_hp_after'],
        ['combat_logs',    'enemy_hp_after'],
        -- chat bosses (mini app raids)
        ['app_raid_hits',  'dmg'],
        ['app_raid_stats', 'dmg'],
        ['app_raid_stats', 'best'],
        ['app_raids',      'hp'],
        ['app_raids',      'max_hp']
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
