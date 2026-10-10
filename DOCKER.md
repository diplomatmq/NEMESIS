# 🐳 Docker Setup для NEMESIS

## 📋 Что включено в Docker Compose:

- **PostgreSQL 15** - основная база данных
- **Redis 7** - кеширование и сессии
- **NEMESIS Bot** - Telegram бот (Node.js)

## 🚀 Быстрый старт

### 1. Создайте файл `.env`

```bash
cp .env.example .env
```

Заполните обязательные поля:
```env
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
BOT_USERNAME=your_bot_username_bot
```

### 2. Запустите все сервисы

```bash
docker-compose up -d --build
```

Эта команда:
- ✅ Соберёт Docker образ бота
- ✅ Запустит PostgreSQL
- ✅ Запустит Redis
- ✅ Дождётся готовности БД
- ✅ Автоматически выполнит миграции
- ✅ Запустит бота

### 3. Проверьте статус

```bash
docker-compose ps
```

Должно показать:
```
NAME                IMAGE                  STATUS
nemesis_bot         nemesis-bot           Up
nemesis_postgres    postgres:15-alpine    Up (healthy)
nemesis_redis       redis:7-alpine        Up (healthy)
```

### 4. Смотрите логи

```bash
# Все сервисы
docker-compose logs -f

# Только бот
docker-compose logs -f bot

# Только БД
docker-compose logs -f postgres
```

## 🛠️ Полезные команды

### Перезапуск бота (без пересборки)

```bash
docker-compose restart bot
```

### Пересборка и запуск (после изменения кода)

```bash
docker-compose up -d --build bot
```

### Остановка всех сервисов

```bash
docker-compose down
```

### Остановка + удаление данных (⚠️ удалит БД!)

```bash
docker-compose down -v
```

### Выполнить миграции вручную

```bash
docker-compose exec bot node dist/database/migrations/run.js
```

### Зайти в контейнер бота

```bash
docker-compose exec bot sh
```

### Зайти в PostgreSQL

```bash
docker-compose exec postgres psql -U postgres -d nemesis_game
```

### Зайти в Redis CLI

```bash
docker-compose exec redis redis-cli
```

## 📊 Архитектура контейнеров

```
┌─────────────────────────────────────────┐
│          nemesis_network (bridge)        │
│                                          │
│  ┌──────────────┐  ┌──────────────┐    │
│  │  PostgreSQL  │  │    Redis     │    │
│  │    :5432     │  │    :6379     │    │
│  └──────┬───────┘  └──────┬───────┘    │
│         │                  │             │
│         └──────┬───────────┘             │
│                │                         │
│         ┌──────▼───────┐                │
│         │  NEMESIS Bot │                │
│         │    :3000     │                │
│         └──────────────┘                │
│                                          │
└─────────────────────────────────────────┘
          ▲
          │
    Хост машина
    localhost:5432 (PostgreSQL)
    localhost:6379 (Redis)
    localhost:3000 (Bot - если webhook)
```

## 🔧 Переменные окружения в Docker

Бот в контейнере автоматически использует:

```env
# Базы данных внутри сети Docker
DB_HOST=postgres
REDIS_HOST=redis
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=nemesis_game

# Остальное из вашего .env файла
BOT_TOKEN=${BOT_TOKEN}
BOT_USERNAME=${BOT_USERNAME}
...
```

Для совместимости с уже созданным Docker volume Compose использует стабильные
учетные данные PostgreSQL `postgres/postgres`. Изменение `DB_PASSWORD` в `.env`
не меняет пароль в существующем volume PostgreSQL.

## 🐛 Troubleshooting

### Бот не запускается

```bash
# Смотрим логи
docker-compose logs bot

# Проверяем, что БД работает
docker-compose exec postgres pg_isready -U postgres
```

### БД не готова

```bash
# Перезапускаем PostgreSQL
docker-compose restart postgres

# Проверяем здоровье
docker-compose ps postgres
```

### Ошибка "network nemesis_network not found"

```bash
# Пересоздать всё
docker-compose down
docker-compose up -d --build
```

### Бот не видит изменения в коде

```bash
# Пересобрать образ
docker-compose build bot
docker-compose up -d bot
```

## 🏗️ Разработка с Docker

### Вариант 1: Полностью в Docker

```bash
docker-compose up -d --build
```

**Плюсы:**
- ✅ Полная изоляция
- ✅ Одинаково на всех машинах
- ✅ Не нужно устанавливать Node.js локально

**Минусы:**
- ❌ Нужно пересобирать после каждого изменения

### Вариант 2: Только БД в Docker, бот локально

```bash
# Запустить только БД
docker-compose up -d postgres redis

# Бот запустить локально
npm run dev
```

**Плюсы:**
- ✅ Мгновенный hot-reload
- ✅ Удобная отладка

**Минусы:**
- ❌ Нужен Node.js на машине

## 📦 Production Deployment

Для продакшена рекомендуется:

1. **Использовать внешние managed сервисы:**
   - AWS RDS / Google Cloud SQL для PostgreSQL
   - AWS ElastiCache для Redis

2. **Деплой бота:**
   - AWS ECS / Google Cloud Run
   - Kubernetes
   - Простой VPS с Docker

3. **Настроить webhook** вместо long polling

4. **Добавить мониторинг:**
   - Prometheus + Grafana
   - Sentry для ошибок

## 🔐 Безопасность

### В продакшене:

1. **Используйте секреты:**
   ```bash
   docker secret create bot_token /run/secrets/bot_token
   ```

2. **Не используйте дефолтные пароли:**
   ```env
   DB_PASSWORD=generate_strong_password_here
   ```

3. **Ограничьте сеть:**
   - Не публикуйте PostgreSQL и Redis наружу
   - Используйте internal networks

4. **Регулярно обновляйте образы:**
   ```bash
   docker-compose pull
   docker-compose up -d --build
   ```

## 📝 Backup БД в Docker

```bash
# Создать backup
docker-compose exec postgres pg_dump -U postgres nemesis_game > backup.sql

# Восстановить backup
docker-compose exec -T postgres psql -U postgres nemesis_game < backup.sql
```

## ✨ Готово!

Теперь у вас полностью контейнеризованное приложение! 🎉
