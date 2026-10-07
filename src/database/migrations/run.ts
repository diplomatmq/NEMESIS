import fs from 'fs';
import path from 'path';
import { db } from '../db';

async function runMigrations() {
  try {
    console.log('Starting database migrations...');

    const schemaState = await db.query(`
      SELECT
        (
          to_regclass('public.users') IS NOT NULL
          AND to_regclass('public.chats') IS NOT NULL
          AND to_regclass('public.player_progress') IS NOT NULL
        ) AS schema_exists,
        to_regclass('public.player_progress_old') IS NOT NULL AS global_progress_applied,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'player_progress'
            AND column_name = 'chat_id'
        ) AS player_progress_is_chat_scoped
    `);
    const currentSchema = schemaState.rows[0];

    // Run schema migration
    if (!currentSchema.schema_exists) {
      const schemaFile = path.join(__dirname, '001_initial_schema.sql');
      const schemaSql = fs.readFileSync(schemaFile, 'utf8');
      await db.query(schemaSql);
      console.log('✅ Schema created');
    } else {
      console.log('✅ Existing database schema detected');
    }

    // Run seed data
    const seedFile = path.join(__dirname, '002_seed_data.sql');
    const seedSql = fs.readFileSync(seedFile, 'utf8');
    await db.query(seedSql);
    console.log('✅ Seed data inserted');

    // Run achievements migration
    const achievementsFile = path.join(__dirname, '003_achievements.sql');
    const achievementsSql = fs.readFileSync(achievementsFile, 'utf8');
    await db.query(achievementsSql);
    console.log('✅ Achievements created');

    // Run global progress migration
    const shouldRunGlobalProgressMigration =
      !currentSchema.global_progress_applied &&
      (!currentSchema.schema_exists || currentSchema.player_progress_is_chat_scoped);

    if (shouldRunGlobalProgressMigration) {
      const globalProgressFile = path.join(__dirname, '004_global_progress.sql');
      const globalProgressSql = fs.readFileSync(globalProgressFile, 'utf8');
      await db.query(globalProgressSql);
      console.log('✅ Global progress migration completed');
    } else {
      console.log('✅ Global progress migration already applied');
    }

    const classItemsFile = path.join(__dirname, '005_class_items.sql');
    const classItemsSql = fs.readFileSync(classItemsFile, 'utf8');
    await db.query(classItemsSql);
    console.log('✅ Class items migration completed');

    const seasonOneEnemiesFile = path.join(__dirname, '006_season_one_enemies.sql');
    const seasonOneEnemiesSql = fs.readFileSync(seasonOneEnemiesFile, 'utf8');
    await db.query(seasonOneEnemiesSql);
    console.log('✅ Season 1 enemy catalog completed');

    const achievementProgressFile = path.join(__dirname, '007_fix_achievement_progress_fk.sql');
    const achievementProgressSql = fs.readFileSync(achievementProgressFile, 'utf8');
    await db.query(achievementProgressSql);
    console.log('✅ Achievement progress references repaired');

    const requiredTables = await db.query(`
      SELECT
        current_database() AS database_name,
        to_regclass('public.users') AS users_table,
        to_regclass('public.chats') AS chats_table,
        to_regclass('public.player_progress') AS progress_table
    `);
    const schema = requiredTables.rows[0];
    if (!schema.users_table || !schema.chats_table || !schema.progress_table) {
      throw new Error(
        `Migration completed against an incomplete schema in ${schema.database_name}: ` +
        'users, chats, and player_progress are required'
      );
    }

    console.log('✅ Database migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
