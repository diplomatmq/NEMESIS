# Исправление миграций и безопасное обновление

## Что было исправлено

### 1. **Система учета миграций**
- Создана таблица `schema_migrations` для отслеживания примененных миграций
- Миграции теперь не выполняются повторно
- Файл `000_migrations_table.sql` создает систему учета

### 2. **Миграция 004 (Global Progress)**
- Добавлена защита от повторного запуска
- Проверка существования таблицы `player_progress_old`
- Безопасная миграция данных без потерь

### 3. **Миграция 006 (Season One Enemies)**
- Защита от повторного удаления боссов
- Проверка количества боссов перед операциями
- Безопасная вставка данных с проверкой существования

### 4. **Согласованность паролей**
- Docker Compose теперь использует `DB_PASSWORD` из `.env`
- Устранена проблема с hardcoded паролем `postgres:postgres`

## Пошаговая инструкция по обновлению

### Вариант 1: Обновление существующей БД (РЕКОМЕНДУЕТСЯ)

```powershell
# Шаг 1: Создайте резервную копию
.\backup_db.ps1

# Шаг 2: Проверьте текущее состояние БД
npm run db:check

# Шаг 3: Пересоберите приложение
docker compose build bot

# Шаг 4: Запустите контейнеры (миграции выполнятся автоматически)
docker compose up -d

# Шаг 5: Проверьте логи миграций
docker compose logs --tail=200 bot

# Шаг 6: Проверьте состояние после миграций
npm run db:check
```

### Вариант 2: Полное пересоздание БД

⚠️ **ВНИМАНИЕ**: Это удалит все данные!

```powershell
# Шаг 1: Остановите контейнеры
docker compose down

# Шаг 2: Удалите volumes
docker volume rm nemesis_postgres_data
docker volume rm nemesis_redis_data

# Шаг 3: Пересоберите и запустите
docker compose build bot
docker compose up -d

# Шаг 4: Проверьте логи
docker compose logs --tail=200 bot

# Шаг 5: Проверьте состояние
npm run db:check
```

## Проверка результатов

### Ожидаемые результаты в логах:

```
🚀 Starting database migrations...

▶️  Running: 000_migrations_table...
✅ Completed: 000_migrations_table (45ms)

▶️  Running: 001_initial_schema...
✅ Completed: 001_initial_schema (120ms)

▶️  Running: 002_seed_data...
✅ Completed: 002_seed_data (80ms)

▶️  Running: 004_global_progress...
✅ Completed: 004_global_progress (200ms)

▶️  Running: 006_season_one_enemies...
✅ Completed: 006_season_one_enemies (350ms)

📊 Migration Summary:
   Applied: 13
   Skipped: 0
   Total: 13

✅ Database migrations completed successfully!
```

### При повторном запуске:

```
🚀 Starting database migrations...

⏭️  Skipped: 000_migrations_table (already applied)
⏭️  Skipped: 001_initial_schema (already applied)
⏭️  Skipped: 002_seed_data (already applied)
...

📊 Migration Summary:
   Applied: 0
   Skipped: 13
   Total: 13
```

### Проверка состояния с помощью `npm run db:check`:

```
🔍 Проверка состояния базы данных...

📋 Применённые миграции:
   ✓ 000_migrations_table (45ms)
   ✓ 001_initial_schema (120ms)
   ✓ 002_seed_data (80ms)
   ...

👥 Пользователи: 5
💬 Чаты: 3
🎮 Записи прогресса: 5
📦 Старые записи прогресса (player_progress_old): 5

🐉 Боссы по сезонам:
   Сезон 1: 50 боссов

👾 Обычные враги по сезонам:
   Сезон 1: 150 врагов

📐 Структура player_progress:
   ✓ Глобальная структура (user_id, без chat_id)

✅ Проверка завершена
```

## Устранение проблем

### Проблема: "Migration 004 failed"

**Решение**: Проверьте, существует ли таблица `player_progress`:
```sql
SELECT * FROM information_schema.tables WHERE table_name = 'player_progress';
```

### Проблема: "Permission denied for database"

**Решение**: Проверьте пароль в `.env` соответствует настройкам Docker:
```powershell
# Проверьте переменные окружения в контейнере
docker exec nemesis_bot env | Select-String "DB_"
```

### Проблема: "All data was deleted"

**Решение**: Восстановите из резервной копии:
```powershell
# Найдите последний backup файл
Get-ChildItem backup_*.sql | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# Восстановите из backup (замените filename на имя вашего файла)
Get-Content backup_nemesis_game_YYYYMMDD_HHMMSS.sql | docker exec -i nemesis_postgres psql -U postgres -d nemesis_game
```

## Проверка данных до и после

### До обновления:

```powershell
npm run db:check > before_migration.txt
```

### После обновления:

```powershell
npm run db:check > after_migration.txt
```

### Сравните:

```powershell
Compare-Object (Get-Content before_migration.txt) (Get-Content after_migration.txt)
```

## Команды для быстрой диагностики

```powershell
# Проверить статус контейнеров
docker compose ps

# Проверить логи бота
docker compose logs bot --tail=100 --follow

# Проверить логи БД
docker compose logs postgres --tail=50

# Подключиться к БД
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game

# Проверить применённые миграции
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game -c "SELECT * FROM schema_migrations ORDER BY applied_at;"
```

## Безопасность

### Важные моменты:

1. **Всегда создавайте резервную копию** перед обновлением
2. **Проверяйте логи** после каждого изменения
3. **Используйте `npm run db:check`** для мониторинга состояния
4. **Не удаляйте volumes** без резервной копии
5. **Храните backup файлы** в безопасном месте

### Автоматизация резервного копирования:

Добавьте в планировщик задач Windows или создайте cron job:

```powershell
# Запускать каждый день в 3:00
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-File C:\path\to\project\backup_db.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "Nemesis DB Backup" -Description "Daily backup of Nemesis game database"
```

## Контакты для поддержки

При возникновении проблем:
1. Проверьте логи: `docker compose logs bot`
2. Проверьте состояние: `npm run db:check`
3. Создайте issue с логами и результатами проверки
