-- Keep cooldowns user-global, matching the application queries and 004_global_progress.

DO $$
BEGIN
  IF to_regclass('public.cooldowns') IS NOT NULL THEN
    DELETE FROM cooldowns first_row
    USING cooldowns duplicate_row
    WHERE first_row.user_id = duplicate_row.user_id
      AND first_row.action_type = duplicate_row.action_type
      AND first_row.id > duplicate_row.id;

    ALTER TABLE cooldowns
      DROP CONSTRAINT IF EXISTS cooldowns_user_id_chat_id_action_type_key;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.cooldowns'::regclass
        AND conname = 'cooldowns_user_id_action_type_key'
    ) THEN
      ALTER TABLE cooldowns
        ADD CONSTRAINT cooldowns_user_id_action_type_key
        UNIQUE (user_id, action_type);
    END IF;
  END IF;
END
$$;
