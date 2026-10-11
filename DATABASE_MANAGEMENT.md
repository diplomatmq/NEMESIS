# 🗄️ Управление Базой Данных NEMESIS

## 📋 Содержание

1. [Безопасное развёртывание](#безопасное-развёртывание)
2. [Резервное копирование](#резервное-копирование)
3. [Восстановление базы данных](#восстановление-базы-данных)
4. [Полная очистка и пересоздание](#полная-очистка-и-пересоздание)
5. [Диагностика проблем](#диагностика-проблем)
6. [Миграции](#миграции)

---

## 🚀 Безопасное развёртывание

### Первый запуск (автоматическое создание БД)

```bash
# 1. Убедитесь, что .env.local настроен с правильными секретами
cd /opt/bots/NEMESIS

# 2. Запустите контейнеры
docker compose up -d

# 3. Проверьте логи
docker compose logs -f bot
```

**Что происходит автоматически:**
- ✅ PostgreSQL запускается и инициализируется
- ✅ Проверяется существование базы `nemesis_game`
- ✅ Если базы нет - она создаётся автоматически
- ✅ Если база есть - используется существующая (данные сохраняются!)
- ✅ Выполняются миграции схемы
- ✅ Бот запускается

### Повторный запуск (с сохранением данных)

```bash
# Просто перезапустите контейнеры
docker compose restart

# Или остановите и запустите снова
docker compose down
docker compose up -d
```

**⚠️ ВАЖНО:** Команда `docker compose down` БЕЗ флага `-v` НЕ удаляет данные!

---

## 💾 Резервное копирование

### Автоматический бэкап (рекомендуется)

```bash
#!/bin/bash
# Сохраните как /opt/bots/NEMESIS/scripts/backup.sh

BACKUP_DIR="/opt/bots/NEMESIS/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/nemesis_backup_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

# Создать бэкап
docker exec nemesis_postgres pg_dump -U postgres nemesis_game | gzip > "$BACKUP_FILE"

echo "✅ Backup created: $BACKUP_FILE"

# Удалить бэкапы старше 7 дней
find "$BACKUP_DIR" -name "nemesis_backup_*.sql.gz" -mtime +7 -delete
echo "🧹 Old backups cleaned"
```

Запуск бэкапа:
```bash
chmod +x /opt/bots/NEMESIS/scripts/backup.sh
/opt/bots/NEMESIS/scripts/backup.sh
```

### Настройка автоматического бэкапа (cron)

```bash
# Добавить в crontab (выполняется каждый день в 03:00)
crontab -e

# Добавьте строку:
0 3 * * * /opt/bots/NEMESIS/scripts/backup.sh >> /opt/bots/NEMESIS/logs/backup.log 2>&1
```

### Ручной бэкап

```bash
# Полный бэкап базы данных
docker exec nemesis_postgres pg_dump -U postgres nemesis_game > nemesis_backup.sql

# Сжатый бэкап (экономит место)
docker exec nemesis_postgres pg_dump -U postgres nemesis_game | gzip > nemesis_backup.sql.gz

# Бэкап с timestep
docker exec nemesis_postgres pg_dump -U postgres nemesis_game | gzip > "nemesis_backup_$(date +%Y%m%d_%H%M%S).sql.gz"
```

### Бэкап только данных (без схемы)

```bash
docker exec nemesis_postgres pg_dump -U postgres --data-only nemesis_game | gzip > nemesis_data_only.sql.gz
```

---

## 🔄 Восстановление базы данных

### Восстановление из бэкапа

```bash
# 1. Остановите бота (но не PostgreSQL!)
docker compose stop bot

# 2. Восстановите из несжатого бэкапа
docker exec -i nemesis_postgres psql -U postgres nemesis_game < nemesis_backup.sql

# 3. ИЛИ из сжатого бэкапа
gunzip -c nemesis_backup.sql.gz | docker exec -i nemesis_postgres psql -U postgres nemesis_game

# 4. Запустите бота
docker compose start bot
```

### Восстановление с полным пересозданием БД

```bash
# ⚠️ ВНИМАНИЕ: Это удалит ВСЕ данные!

# 1. Остановите бота
docker compose stop bot

# 2. Подключитесь к PostgreSQL
docker exec -it nemesis_postgres psql -U postgres

# 3. В psql выполните:
DROP DATABASE IF EXISTS nemesis_game;
CREATE DATABASE nemesis_game OWNER postgres;
\q

# 4. Восстановите из бэкапа
gunzip -c nemesis_backup.sql.gz | docker exec -i nemesis_postgres psql -U postgres nemesis_game

# 5. Запустите бота
docker compose start bot
```

---

## 🗑️ Полная очистка и пересоздание

### ⚠️ ОПАСНО: Удаление ВСЕХ данных

Используйте эти команды ТОЛЬКО если хотите полностью удалить все данные и начать с нуля.

```bash
# 1. Остановите и удалите все контейнеры
cd /opt/bots/NEMESIS
docker compose down

# 2. Удалите Docker volumes (ВСЕ ДАННЫЕ БУДУТ ПОТЕРЯНЫ!)
docker volume rm nemesis_postgres_data
docker volume rm nemesis_redis_data

# 3. Убедитесь, что volumes удалены
docker volume ls | grep nemesis

# 4. Запустите заново (создастся чистая БД)
docker compose up -d

# 5. Проверьте логи
docker compose logs -f bot
```

### Очистка только PostgreSQL (сохранить Redis)

```bash
# 1. Остановите контейнеры
docker compose down

# 2. Удалите только PostgreSQL volume
docker volume rm nemesis_postgres_data

# 3. Запустите снова
docker compose up -d
```

### Пересоздание без удаления контейнеров (быстрее)

```bash
# 1. Остановите бота
docker compose stop bot

# 2. Подключитесь к PostgreSQL
docker exec -it nemesis_postgres psql -U postgres

# 3. Удалите и пересоздайте базу
DROP DATABASE IF EXISTS nemesis_game;
CREATE DATABASE nemesis_game OWNER postgres;
\q

# 4. Запустите бота (миграции выполнятся автоматически)
docker compose start bot
```

---

## 🔍 Диагностика проблем

### Проверка состояния контейнеров

```bash
# Статус всех контейнеров
docker compose ps

# Логи PostgreSQL
docker compose logs postgres

# Логи бота
docker compose logs bot

# Следить за логами в реальном времени
docker compose logs -f bot
```

### Проверка базы данных

```bash
# Подключиться к PostgreSQL
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game

# В psql выполните:
\dt                           -- Список таблиц
\d users                      -- Структура таблицы users
SELECT COUNT(*) FROM users;   -- Количество пользователей
SELECT * FROM schema_migrations ORDER BY id; -- Список выполненных миграций

\q  -- Выход
```

### Проверка Docker volumes

```bash
# Список всех volumes
docker volume ls

# Информация о конкретном volume
docker volume inspect nemesis_postgres_data

# Размер данных в volume
docker system df -v | grep nemesis
```

### Проверка подключения к БД

```bash
# Из контейнера бота
docker exec nemesis_bot sh -c 'node -e "const {db} = require(\"./dist/database/db.js\"); db.query(\"SELECT NOW()\").then(() => console.log(\"✅ Connected\")).catch(err => console.error(\"❌ Error:\", err))"'
```

### Логи PostgreSQL

```bash
# Последние 100 строк логов
docker compose logs --tail=100 postgres

# Поиск ошибок в логах
docker compose logs postgres | grep -i error

# Логи восстановления после сбоя
docker compose logs postgres | grep -i "recovery"
```

---

## 📦 Миграции

### Проверка состояния миграций

```bash
# Список выполненных миграций
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game -c "SELECT migration_name, applied_at, execution_time_ms FROM schema_migrations ORDER BY id;"
```

### Ручной запуск миграций

```bash
# Из контейнера бота
docker exec nemesis_bot node dist/database/migrations/run.js
```

### Откат миграции (осторожно!)

```bash
# Подключитесь к базе
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game

# Удалите запись о миграции (НЕ откатывает изменения!)
DELETE FROM schema_migrations WHERE migration_name = '015_translate_effects';

# Теперь при перезапуске бота миграция выполнится снова
```

---

## 🆘 Частые проблемы

### Проблема: "database nemesis_game does not exist"

**Решение:**
```bash
# Бот теперь создаёт базу автоматически при запуске
docker compose restart bot

# Если не помогло, создайте вручную:
docker exec -it nemesis_postgres psql -U postgres -c "CREATE DATABASE nemesis_game OWNER postgres;"
docker compose restart bot
```

### Проблема: PostgreSQL постоянно восстанавливается

**Возможные причины:**
- Некорректное завершение контейнера
- Проблемы с Docker volume
- Недостаточно места на диске

**Решение:**
```bash
# 1. Создайте бэкап если возможно
docker exec nemesis_postgres pg_dump -U postgres nemesis_game > emergency_backup.sql

# 2. Остановите контейнеры
docker compose down

# 3. Проверьте место на диске
df -h

# 4. Если места достаточно, запустите снова
docker compose up -d

# 5. Если проблема повторяется, пересоздайте volume:
docker compose down
docker volume rm nemesis_postgres_data
# Восстановите из бэкапа (см. раздел "Восстановление")
```

### Проблема: Миграции падают с ошибкой

```bash
# 1. Проверьте логи
docker compose logs bot

# 2. Подключитесь к БД и проверьте схему
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game
\dt

# 3. Если нужно, сбросьте проблемную миграцию
DELETE FROM schema_migrations WHERE migration_name = 'PROBLEM_MIGRATION_NAME';

# 4. Перезапустите бота
docker compose restart bot
```

---

## 📞 Дополнительная информация

- **Документация PostgreSQL**: https://www.postgresql.org/docs/
- **Docker Compose**: https://docs.docker.com/compose/
- **Логи проекта**: `/opt/bots/NEMESIS/logs/`
- **Бэкапы**: `/opt/bots/NEMESIS/backups/`
