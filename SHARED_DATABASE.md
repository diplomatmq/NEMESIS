# 🗄️ Общая база данных для бота и мини-приложения

## Архитектура

И основной бот (TypeScript), и мини-приложение (Python) используют **одну и ту же PostgreSQL базу данных**. Это обеспечивает:

- ✅ Единое место хранения всех данных
- ✅ Нет необходимости в синхронизации между базами
- ✅ Упрощённые бэкапы (одна база вместо двух)
- ✅ Возможность совместного использования данных пользователей

## Разделение данных

Чтобы избежать конфликтов между таблицами бота и мини-приложения, используется **префиксная схема**:

| Владелец | Префикс таблиц | Примеры |
|----------|---------------|---------|
| **Основной бот** | Без префикса | `users`, `chats`, `player_progress` |
| **Мини-приложение** | `app_` | `app_players`, `app_raids`, `app_saves` |

### Основной бот (TypeScript)

```
users                    -- Пользователи Telegram
chats                    -- Telegram чаты
seasons                  -- Игровые сезоны
player_progress          -- Прогресс игрока в чат-игре
cooldowns                -- Cooldowns для действий
items                    -- Предметы
enemies                  -- Противники
classes                  -- Классы персонажей
... (около 40 таблиц)
```

### Мини-приложение (Python)

```
app_players              -- Игроки мини-приложения
app_raids                -- Рейды на боссов в чатах
app_saves                -- Облачные сохранения игры
app_duels                -- PvP дуэли
app_fight_log            -- Логи боёв
app_star_ledger          -- Экономика звёзд
app_quests               -- Квесты
... (около 15 таблиц)
```

## Технические детали

### PostgreSQL Adapter для Python

Мини-приложение изначально было написано для SQLite. Для совместимости создан **адаптер** (`db_adapter.py`), который:

1. **Предоставляет SQLite-подобный интерфейс** для существующего кода
2. **Автоматически добавляет префикс `app_`** ко всем таблицам
3. **Конвертирует SQL синтаксис** из SQLite в PostgreSQL
4. **Использует thread-local соединения** для безопасности в многопоточной среде

#### Пример использования:

```python
# Старый код (SQLite)
db = sqlite3.connect("emberspire.db")
cursor = db.execute("SELECT * FROM players WHERE id=?", (user_id,))

# Новый код (PostgreSQL через адаптер) - работает так же!
from db_adapter import get_db
db = get_db()
cursor = db.execute("SELECT * FROM players WHERE id=?", (user_id,))
# Реально выполняется: SELECT * FROM app_players WHERE id=%s
```

### Автоматическое добавление префикса

Адаптер перехватывает все SQL запросы и добавляет префикс `app_` к таблицам:

```python
# Входной запрос
"SELECT * FROM players WHERE room > 10"

# После обработки адаптером
"SELECT * FROM app_players WHERE room > 10"
```

Поддерживаемые операции:
- `CREATE TABLE`
- `INSERT INTO`
- `SELECT FROM`
- `UPDATE`
- `DELETE FROM`
- `JOIN`

### Конвертация типов данных

SQLite → PostgreSQL:

| SQLite | PostgreSQL |
|--------|-----------|
| `INTEGER` | `INTEGER` / `BIGINT` |
| `REAL` | `DOUBLE PRECISION` / `TIMESTAMP` |
| `TEXT` | `TEXT` |
| `?` (placeholder) | `%s` |

## Миграция 044: Таблицы мини-приложения

Файл: `src/database/migrations/044_miniapp_tables.sql`

Создаёт все необходимые таблицы для мини-приложения:

```sql
-- Игроки
CREATE TABLE app_players (
    id BIGINT PRIMARY KEY,
    name TEXT,
    username TEXT,
    cls TEXT,
    room INTEGER DEFAULT 0,
    ...
);

-- Рейды
CREATE TABLE app_raids (
    ci TEXT NOT NULL,
    week INTEGER NOT NULL,
    hp INTEGER,
    ...
);

-- Сохранения
CREATE TABLE app_saves (
    uid BIGINT PRIMARY KEY,
    data TEXT,  -- JSON
    ...
);

-- И ещё ~12 таблиц
```

## Конфигурация

### Основной бот (TypeScript)

```typescript
// src/database/db.ts
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
```

### Мини-приложение (Python)

```python
# app/ebashnya/app/db_adapter.py
connection_params = {
    'host': os.environ.get('DB_HOST', 'localhost'),
    'port': int(os.environ.get('DB_PORT', '5432')),
    'database': os.environ.get('DB_NAME', 'nemesis_game'),
    'user': os.environ.get('DB_USER', 'postgres'),
    'password': os.environ.get('DB_PASSWORD', ''),
}
```

### Docker Compose

Оба сервиса используют одни и те же переменные окружения:

```yaml
services:
  bot:
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: nemesis_game
      DB_USER: postgres
      DB_PASSWORD: ${DB_PASSWORD}
  
  miniapp:
    environment:
      DB_HOST: postgres      # <-- То же самое!
      DB_PORT: 5432
      DB_NAME: nemesis_game
      DB_USER: postgres
      DB_PASSWORD: ${DB_PASSWORD}
```

## Запуск и миграции

### Первый запуск

```bash
# 1. Настроить переменные окружения
cp .env.example .env.local
nano .env.local  # Заполнить DB_PASSWORD

# 2. Запустить Docker Compose
docker-compose up -d

# 3. Миграции выполняются автоматически ботом при старте
# Включая миграцию 044 для таблиц мини-приложения
```

### Проверка таблиц

```bash
# Подключиться к PostgreSQL
docker-compose exec postgres psql -U postgres -d nemesis_game

# Показать все таблицы
\dt

# Показать только таблицы мини-приложения
\dt app_*

# Пример вывода:
#  app_players
#  app_raids
#  app_saves
#  app_duels
#  app_fight_log
#  ... и т.д.
```

## Разделение пользователей

### Сценарий 1: Пользователь только в чате

```
Таблицы бота:
  users (telegram_id=123456)
  player_progress (user_id=..., chat_id=...)
  
Таблицы мини-приложения:
  (нет записей)
```

### Сценарий 2: Пользователь только в мини-приложении

```
Таблицы бота:
  users (telegram_id=123456)  -- Создаётся при /start
  
Таблицы мини-приложения:
  app_players (id=123456)
  app_saves (uid=123456)
```

### Сценарий 3: Пользователь в обоих

```
Таблицы бота:
  users (telegram_id=123456)
  player_progress (user_id=..., chat_id=...)
  
Таблицы мини-приложения:
  app_players (id=123456)
  app_saves (uid=123456)
```

**Важно:** Прогресс в чат-игре и мини-приложении **независимый**! Это две разные игры с общим ботом.

## Преимущества общей базы

### 1. Унифицированные админ-команды

```typescript
// В боте можно получить статистику из обоих игр
const chatPlayers = await db.query('SELECT COUNT(*) FROM player_progress');
const appPlayers = await db.query('SELECT COUNT(*) FROM app_players');
```

### 2. Единый бэкап

```bash
# Один дамп содержит все данные
pg_dump nemesis_game > backup.sql

# Восстановление
psql nemesis_game < backup.sql
```

### 3. Возможность кросс-анализа

```sql
-- Найти пользователей играющих в обе игры
SELECT u.telegram_id, u.username, pp.floor, ap.room
FROM users u
JOIN player_progress pp ON pp.user_id = u.id
JOIN app_players ap ON ap.id = u.telegram_id
WHERE pp.floor > 50 AND ap.room > 30;
```

### 4. Упрощённое развёртывание

```bash
# Один PostgreSQL контейнер вместо двух баз данных
docker-compose up -d postgres  # <-- Всё данные здесь
```

## Безопасность

### Изоляция на уровне приложения

- Бот **не трогает** таблицы с префиксом `app_`
- Мини-приложение **не трогает** таблицы без префикса
- Конфликты **невозможны** благодаря префиксам

### Права доступа

```sql
-- Оба приложения используют одного пользователя PostgreSQL
-- В будущем можно разделить права:

CREATE USER bot_user WITH PASSWORD 'bot_password';
CREATE USER app_user WITH PASSWORD 'app_password';

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bot_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_* TO app_user;
```

## Мониторинг

### Размер таблиц

```sql
-- Размер таблиц бота
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename NOT LIKE 'app_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Размер таблиц мини-приложения
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename LIKE 'app_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Активность

```sql
-- Последняя активность игроков в чате
SELECT MAX(updated_at) FROM player_progress;

-- Последняя активность в мини-приложении
SELECT MAX(updated) FROM app_players;
```

## Troubleshooting

### Проблема: "relation app_players does not exist"

**Решение:** Запустить миграции

```bash
docker-compose exec bot npm run migrate
```

### Проблема: Мини-приложение не подключается к БД

**Проверка:**

```bash
# Проверить переменные окружения
docker-compose exec miniapp env | grep DB_

# Должны быть установлены:
# DB_HOST=postgres
# DB_PORT=5432
# DB_NAME=nemesis_game
# DB_USER=postgres
# DB_PASSWORD=...
```

### Проблема: Ошибки конвертации типов

**Причина:** Адаптер не распознал тип данных SQLite

**Решение:** Обновить `db_adapter.py`, добавив новое правило конвертации

## Будущие улучшения

- [ ] Shared cache через Redis для обоих приложений
- [ ] Унифицированная система логирования
- [ ] Общая таблица `users` вместо дублирования
- [ ] Кросс-платформенные достижения
- [ ] Единый экономический баланс Telegram Stars
- [ ] Миграция данных между чат-игрой и мини-приложением

---

**Вывод:** Общая база данных упрощает архитектуру, делает развёртывание проще и открывает возможности для будущей интеграции между чат-игрой и мини-приложением!
