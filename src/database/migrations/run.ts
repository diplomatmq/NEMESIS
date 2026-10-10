import fs from 'fs';
import path from 'path';
import { db } from '../db';

interface Migration {
  name: string;
  file: string;
  order: number;
}

async function isMigrationApplied(migrationName: string): Promise<boolean> {
  try {
    const result = await db.query(
      'SELECT 1 FROM schema_migrations WHERE migration_name = $1',
      [migrationName]
    );
    return result.rows.length > 0;
  } catch (error) {
    // If schema_migrations table doesn't exist yet, no migrations are applied
    return false;
  }
}

async function recordMigration(migrationName: string, executionTimeMs: number): Promise<void> {
  try {
    await db.query(
      'INSERT INTO schema_migrations (migration_name, applied_at, execution_time_ms) VALUES ($1, CURRENT_TIMESTAMP, $2) ON CONFLICT (migration_name) DO NOTHING',
      [migrationName, executionTimeMs]
    );
  } catch (error) {
    console.warn(`⚠️ Could not record migration ${migrationName}:`, error);
  }
}

async function runMigrations() {
  try {
    console.log('🚀 Starting database migrations...\n');

    // Define migrations in order
    const migrations: Migration[] = [
      { name: '000_migrations_table', file: '000_migrations_table.sql', order: 0 },
      { name: '001_initial_schema', file: '001_initial_schema.sql', order: 1 },
      { name: '002_seed_data', file: '002_seed_data.sql', order: 2 },
      { name: '003_achievements', file: '003_achievements.sql', order: 3 },
      { name: '004_global_progress', file: '004_global_progress.sql', order: 4 },
      { name: '005_class_items', file: '005_class_items.sql', order: 5 },
      { name: '006_season_one_enemies', file: '006_season_one_enemies.sql', order: 6 },
      { name: '007_fix_achievement_progress_fk', file: '007_fix_achievement_progress_fk.sql', order: 7 },
      { name: '008_repair_cooldown_constraint', file: '008_repair_cooldown_constraint.sql', order: 8 },
      { name: '009_trail_events', file: '009_trail_events.sql', order: 9 },
      { name: '010_secure_trail_markets', file: '010_secure_trail_markets.sql', order: 10 },
      { name: '011_necromancer_souls', file: '011_necromancer_souls.sql', order: 11 },
      { name: '012_necromancer_effects', file: '012_necromancer_effects.sql', order: 12 },
      { name: '013_necromancer_pending_soul', file: '013_necromancer_pending_soul.sql', order: 13 },
      { name: '014_fix_zero_stat_items', file: '014_fix_zero_stat_items.sql', order: 14 },
    ];

    let appliedCount = 0;
    let skippedCount = 0;

    for (const migration of migrations) {
      const migrationFile = path.join(__dirname, migration.file);
      
      if (!fs.existsSync(migrationFile)) {
        console.warn(`⚠️ Migration file not found: ${migration.file}`);
        continue;
      }

      // Check if already applied (skip check for 000 as it creates the table)
      if (migration.order > 0) {
        const isApplied = await isMigrationApplied(migration.name);
        if (isApplied) {
          console.log(`⏭️  Skipped: ${migration.name} (already applied)`);
          skippedCount++;
          continue;
        }
      }

      console.log(`▶️  Running: ${migration.name}...`);
      const startTime = Date.now();
      
      try {
        const migrationSql = fs.readFileSync(migrationFile, 'utf8');
        await db.query(migrationSql);
        
        const executionTime = Date.now() - startTime;
        await recordMigration(migration.name, executionTime);
        
        console.log(`✅ Completed: ${migration.name} (${executionTime}ms)\n`);
        appliedCount++;
      } catch (error: any) {
        console.error(`❌ Failed: ${migration.name}`);
        console.error(`   Error: ${error.message}\n`);
        
        // For non-critical migrations, log and continue
        if (migration.order >= 7) {
          console.log(`⚠️  Continuing despite error in ${migration.name}...\n`);
          continue;
        }
        
        throw error;
      }
    }

    // Verify critical tables exist
    console.log('🔍 Verifying database schema...');
    const requiredTables = await db.query(`
      SELECT
        current_database() AS database_name,
        to_regclass('public.users') AS users_table,
        to_regclass('public.chats') AS chats_table,
        to_regclass('public.player_progress') AS progress_table,
        to_regclass('public.seasons') AS seasons_table,
        to_regclass('public.enemies') AS enemies_table
    `);
    
    const schema = requiredTables.rows[0];
    const missingTables = [];
    
    if (!schema.users_table) missingTables.push('users');
    if (!schema.chats_table) missingTables.push('chats');
    if (!schema.progress_table) missingTables.push('player_progress');
    if (!schema.seasons_table) missingTables.push('seasons');
    if (!schema.enemies_table) missingTables.push('enemies');
    
    if (missingTables.length > 0) {
      throw new Error(
        `Migration completed but critical tables are missing: ${missingTables.join(', ')}`
      );
    }

    console.log(`✅ Schema verification passed\n`);
    console.log(`📊 Migration Summary:`);
    console.log(`   Applied: ${appliedCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log(`   Total: ${migrations.length}`);
    console.log(`\n✅ Database migrations completed successfully!`);
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
