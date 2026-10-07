import fs from 'fs';
import path from 'path';
import { db } from '../db';

async function runMigrations() {
  try {
    console.log('Starting database migrations...');

    // Run schema migration
    const schemaFile = path.join(__dirname, '001_initial_schema.sql');
    const schemaSql = fs.readFileSync(schemaFile, 'utf8');
    await db.query(schemaSql);
    console.log('✅ Schema created');

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
    const globalProgressFile = path.join(__dirname, '004_global_progress.sql');
    const globalProgressSql = fs.readFileSync(globalProgressFile, 'utf8');
    await db.query(globalProgressSql);
    console.log('✅ Global progress migration completed');

    const classItemsFile = path.join(__dirname, '005_class_items.sql');
    const classItemsSql = fs.readFileSync(classItemsFile, 'utf8');
    await db.query(classItemsSql);
    console.log('✅ Class items migration completed');

    const seasonOneEnemiesFile = path.join(__dirname, '006_season_one_enemies.sql');
    const seasonOneEnemiesSql = fs.readFileSync(seasonOneEnemiesFile, 'utf8');
    await db.query(seasonOneEnemiesSql);
    console.log('✅ Season 1 enemy catalog completed');

    console.log('✅ Database migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
