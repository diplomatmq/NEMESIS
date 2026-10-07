-- Reconnect achievements to the global player_progress table created by 004_global_progress.
-- The old foreign key still points to player_progress_old after the table rename.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint constraint_info
    JOIN pg_class referenced_table
      ON referenced_table.oid = constraint_info.confrelid
    WHERE constraint_info.conrelid = 'public.player_achievements'::regclass
      AND constraint_info.conname = 'player_achievements_player_progress_id_fkey'
      AND referenced_table.relname = 'player_progress_old'
  ) THEN
    ALTER TABLE player_achievements
      DROP CONSTRAINT player_achievements_player_progress_id_fkey;

    -- Keep one row per global player and achievement before changing the IDs.
    WITH mapped AS (
      SELECT
        pa.id,
        pp.id AS new_progress_id,
        pa.achievement_id,
        ROW_NUMBER() OVER (
          PARTITION BY pp.id, pa.achievement_id
          ORDER BY pa.id
        ) AS row_number
      FROM player_achievements pa
      JOIN player_progress_old old_pp ON old_pp.id = pa.player_progress_id
      JOIN player_progress pp
        ON pp.user_id = old_pp.user_id
       AND pp.season_id = old_pp.season_id
    )
    DELETE FROM player_achievements pa
    USING mapped
    WHERE pa.id = mapped.id
      AND mapped.row_number > 1;

    -- Rows without a matching global progress record cannot be retained.
    DELETE FROM player_achievements pa
    WHERE NOT EXISTS (
      SELECT 1
      FROM player_progress_old old_pp
      JOIN player_progress pp
        ON pp.user_id = old_pp.user_id
       AND pp.season_id = old_pp.season_id
      WHERE old_pp.id = pa.player_progress_id
    );

    UPDATE player_achievements pa
    SET player_progress_id = pp.id
    FROM player_progress_old old_pp
    JOIN player_progress pp
      ON pp.user_id = old_pp.user_id
     AND pp.season_id = old_pp.season_id
    WHERE old_pp.id = pa.player_progress_id;
    ALTER TABLE player_achievements
      ADD CONSTRAINT player_achievements_player_progress_id_fkey
      FOREIGN KEY (player_progress_id)
      REFERENCES player_progress(id)
      ON DELETE CASCADE;
  END IF;
END
$$;
