import { db } from '../db';

async function checkDatabaseState() {
  try {
    console.log('🔍 Проверка состояния базы данных...\n');

    // 1. Проверка применённых миграций
    console.log('📋 Применённые миграции:');
    try {
      const migrations = await db.query(`
        SELECT migration_name, applied_at, execution_time_ms 
        FROM schema_migrations 
        ORDER BY applied_at
      `);
      
      if (migrations.rows.length === 0) {
        console.log('   Нет записей о миграциях');
      } else {
        migrations.rows.forEach((row: any) => {
          console.log(`   ✓ ${row.migration_name} (${row.execution_time_ms}ms)`);
        });
      }
    } catch (error) {
      console.log('   ⚠️ Таблица schema_migrations не существует');
    }
    console.log('');

    // 2. Проверка пользователей
    const usersResult = await db.query('SELECT COUNT(*) as count FROM users');
    console.log(`👥 Пользователи: ${usersResult.rows[0].count}`);

    // 3. Проверка чатов
    const chatsResult = await db.query('SELECT COUNT(*) as count FROM chats');
    console.log(`💬 Чаты: ${chatsResult.rows[0].count}`);

    // 4. Проверка прогресса игроков
    const progressResult = await db.query('SELECT COUNT(*) as count FROM player_progress');
    console.log(`🎮 Записи прогресса: ${progressResult.rows[0].count}`);

    // 5. Проверка старой таблицы прогресса (если есть)
    try {
      const oldProgressResult = await db.query('SELECT COUNT(*) as count FROM player_progress_old');
      console.log(`📦 Старые записи прогресса (player_progress_old): ${oldProgressResult.rows[0].count}`);
    } catch (error) {
      console.log(`📦 Старые записи прогресса (player_progress_old): таблица не существует`);
    }

    // 6. Проверка боссов
    const bossesResult = await db.query(`
      SELECT 
        s.season_number,
        COUNT(*) as boss_count
      FROM enemies e
      JOIN seasons s ON e.season_id = s.id
      WHERE e.is_boss = true
      GROUP BY s.season_number
      ORDER BY s.season_number
    `);
    
    console.log('\n🐉 Боссы по сезонам:');
    if (bossesResult.rows.length === 0) {
      console.log('   Нет боссов');
    } else {
      bossesResult.rows.forEach((row: any) => {
        console.log(`   Сезон ${row.season_number}: ${row.boss_count} боссов`);
      });
    }

    // 7. Проверка обычных врагов
    const mobsResult = await db.query(`
      SELECT 
        s.season_number,
        COUNT(*) as mob_count
      FROM enemies e
      JOIN seasons s ON e.season_id = s.id
      WHERE e.is_boss = false
      GROUP BY s.season_number
      ORDER BY s.season_number
    `);
    
    console.log('\n👾 Обычные враги по сезонам:');
    if (mobsResult.rows.length === 0) {
      console.log('   Нет врагов');
    } else {
      mobsResult.rows.forEach((row: any) => {
        console.log(`   Сезон ${row.season_number}: ${row.mob_count} врагов`);
      });
    }

    // 8. Проверка combat_state
    try {
      const combatResult = await db.query('SELECT COUNT(*) as count FROM combat_state');
      console.log(`\n⚔️ Активные бои: ${combatResult.rows[0].count}`);
    } catch (error) {
      console.log(`\n⚔️ Активные бои: таблица combat_state не существует`);
    }

    // 9. Проверка chat_progress
    try {
      const chatProgressResult = await db.query('SELECT COUNT(*) as count FROM chat_progress');
      console.log(`📊 Записи прогресса по чатам: ${chatProgressResult.rows[0].count}`);
    } catch (error) {
      console.log(`📊 Записи прогресса по чатам: таблица chat_progress не существует`);
    }

    // 10. Проверка структуры player_progress
    console.log('\n📐 Структура player_progress:');
    const columnsResult = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'player_progress'
      ORDER BY ordinal_position
    `);
    
    const hasUserId = columnsResult.rows.some((r: any) => r.column_name === 'user_id');
    const hasChatId = columnsResult.rows.some((r: any) => r.column_name === 'chat_id');
    
    if (hasUserId && !hasChatId) {
      console.log('   ✓ Глобальная структура (user_id, без chat_id)');
    } else if (hasUserId && hasChatId) {
      console.log('   ⚠️ Старая структура (с chat_id) - миграция 004 не применена');
    } else {
      console.log('   ❌ Неизвестная структура');
    }

    console.log('\n✅ Проверка завершена');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Ошибка при проверке:', error);
    process.exit(1);
  }
}

checkDatabaseState();
