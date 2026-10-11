# 🚀 Развёртывание NEMESIS на Сервере

Краткое руководство по развёртыванию бота на production сервере.

---

## 📋 Предварительные требования

На сервере должны быть установлены:
- Docker 20.10+
- Docker Compose 2.0+
- Git

```bash
# Проверить версии
docker --version
docker compose version
git --version
```

---

## 🔧 Первоначальная Установка

### 1. Клонировать репозиторий

```bash
# Перейти в рабочую директорию
cd /opt/bots

# Клонировать проект
git clone <repository-url> NEMESIS
cd NEMESIS
```

### 2. Настроить переменные окружения

```bash
# Скопировать шаблон
cp .env.local.example .env.local

# Отредактировать файл
nano .env.local
```

**Обязательно замените:**
```env
BOT_TOKEN=YOUR_NEW_BOT_TOKEN_HERE        # Получить у @BotFather
DB_PASSWORD=YOUR_SECURE_PASSWORD         # Сгенерировать надёжный пароль
```

**Генерация надёжного пароля:**
```bash
openssl rand -base64 32
```

### 3. Защитить файл с секретами

```bash
# Установить права доступа (только владелец может читать)
chmod 600 .env.local

# Создать симлинк для Docker Compose
ln -sf .env.local .env

# Проверить что .env.local НЕ в Git
git status | grep .env.local
# Должно быть пусто
```

### 4. Создать директории для логов и бэкапов

```bash
mkdir -p logs backups

# Сделать скрипты исполняемыми
chmod +x scripts/*.sh
```

### 5. Запустить бота

```bash
# Собрать и запустить контейнеры
docker compose up -d --build

# Дождаться запуска (15-30 секунд)
sleep 20

# Проверить логи
docker compose logs -f bot
```

**Ожидаемый вывод:**
```
nemesis_bot  | 🚀 Starting NEMESIS Bot...
nemesis_bot  | ✅ PostgreSQL is ready!
nemesis_bot  | ✅ Redis is ready!
nemesis_bot  | 📦 Database 'nemesis_game' does not exist. Creating...
nemesis_bot  | ✅ Database 'nemesis_game' created successfully!
nemesis_bot  | 📦 Running database migrations...
nemesis_bot  | ✅ Database migrations completed successfully!
nemesis_bot  | ✅ Bot is running!
```

---

## ✅ Проверка Работоспособности

### 1. Проверить статус контейнеров

```bash
docker compose ps
```

Все контейнеры должны быть в статусе `Up (healthy)`.

### 2. Проверить базу данных

```bash
# Подключиться к PostgreSQL
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game

# Проверить таблицы
\dt

# Проверить данные
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM items;
SELECT COUNT(*) FROM enemies;

# Выход
\q
```

### 3. Тест бота в Telegram

1. Найдите вашего бота в Telegram
2. Отправьте `/start` в личном чате
3. Добавьте бота в группу
4. Отправьте `/start` в группе
5. Попробуйте выполнить действие: `атака`

---

## 🔄 Обновление Бота

```bash
cd /opt/bots/NEMESIS

# 1. Создать бэкап (ОБЯЗАТЕЛЬНО!)
./scripts/backup.sh

# 2. Остановить бота
docker compose stop bot

# 3. Получить обновления
git pull origin main

# 4. Пересобрать образ
docker compose build bot

# 5. Запустить обновлённого бота
docker compose up -d bot

# 6. Проверить логи
docker compose logs -f bot
```

---

## 💾 Резервное Копирование

### Автоматические бэкапы (рекомендуется)

```bash
# Настроить cron для ежедневных бэкапов в 03:00
crontab -e

# Добавить строку:
0 3 * * * /opt/bots/NEMESIS/scripts/backup.sh >> /opt/bots/NEMESIS/logs/backup.log 2>&1
```

### Ручной бэкап

```bash
cd /opt/bots/NEMESIS
./scripts/backup.sh
```

### Восстановление из бэкапа

```bash
cd /opt/bots/NEMESIS

# Посмотреть доступные бэкапы
ls -lh backups/

# Восстановить из конкретного бэкапа
./scripts/restore.sh backups/nemesis_backup_20240315_120000.sql.gz
```

---

## 🛠️ Управление Сервисами

### Остановка

```bash
cd /opt/bots/NEMESIS

# Остановить все контейнеры
docker compose stop

# ИЛИ остановить только бота (БД продолжит работать)
docker compose stop bot
```

### Запуск

```bash
cd /opt/bots/NEMESIS

# Запустить все контейнеры
docker compose start

# ИЛИ запустить только бота
docker compose start bot
```

### Перезапуск

```bash
cd /opt/bots/NEMESIS

# Перезапустить все
docker compose restart

# ИЛИ только бота
docker compose restart bot
```

### Просмотр логов

```bash
# Все логи
docker compose logs

# Только бот
docker compose logs bot

# В реальном времени
docker compose logs -f bot

# Последние 100 строк
docker compose logs --tail=100 bot
```

---

## 🔍 Диагностика Проблем

### Бот не запускается

```bash
# 1. Проверить логи
docker compose logs bot

# 2. Проверить .env.local
cat .env.local | grep -v PASSWORD

# 3. Проверить подключение к БД
docker exec nemesis_bot sh -c 'nc -z postgres 5432 && echo "✅ DB reachable"'

# 4. Проверить состояние PostgreSQL
docker compose logs postgres | tail -50
```

### База данных не создаётся

```bash
# 1. Проверить логи PostgreSQL
docker compose logs postgres

# 2. Вручную создать базу
docker exec -it nemesis_postgres psql -U postgres -c "CREATE DATABASE nemesis_game OWNER postgres;"

# 3. Перезапустить бота
docker compose restart bot
```

### Миграции падают с ошибкой

```bash
# 1. Посмотреть какие миграции выполнены
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game -c "SELECT * FROM schema_migrations ORDER BY id;"

# 2. Проверить структуру БД
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game -c "\dt"

# 3. Если нужно, сбросить проблемную миграцию
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game -c "DELETE FROM schema_migrations WHERE migration_name = 'MIGRATION_NAME';"

# 4. Перезапустить бота
docker compose restart bot
```

---

## 🗑️ Полная Очистка и Пересоздание

**⚠️ ВНИМАНИЕ: Удалит ВСЕ данные!**

См. подробные инструкции в [CLEANUP_INSTRUCTIONS.md](CLEANUP_INSTRUCTIONS.md)

Быстрая очистка:
```bash
cd /opt/bots/NEMESIS

# Создать бэкап
./scripts/backup.sh

# Удалить volumes
docker compose down
docker volume rm nemesis_postgres_data nemesis_redis_data

# Запустить заново
docker compose up -d
```

---

## 📊 Мониторинг

### Использование ресурсов

```bash
# Статистика контейнеров
docker stats nemesis_bot nemesis_postgres nemesis_redis

# Размер volumes
docker system df -v | grep nemesis

# Использование диска
df -h /var/lib/docker/volumes/
```

### Здоровье сервисов

```bash
# Проверка health checks
docker inspect nemesis_postgres | grep -A 10 Health
docker inspect nemesis_redis | grep -A 10 Health

# Быстрая проверка
docker compose ps
```

---

## 🔐 Безопасность

См. подробные инструкции в [SECURITY.md](SECURITY.md)

### Основные правила:

1. **Никогда не коммитьте .env.local в Git**
2. **Используйте сильные пароли**
3. **Регулярно делайте бэкапы**
4. **Ограничьте доступ к серверу**
5. **Обновляйте Docker образы**

### Замена скомпрометированного токена

```bash
# 1. Получите новый токен у @BotFather
# 2. Обновите .env.local
nano .env.local

# 3. Перезапустите бота
docker compose restart bot
```

---

## 📚 Дополнительная Документация

- [DATABASE_MANAGEMENT.md](DATABASE_MANAGEMENT.md) - Управление БД, бэкапы, восстановление
- [SECURITY.md](SECURITY.md) - Безопасность, защита секретов
- [CLEANUP_INSTRUCTIONS.md](CLEANUP_INSTRUCTIONS.md) - Полная очистка БД
- [README.md](README.md) - Общая информация о проекте

---

## 🆘 Поддержка

Если возникли проблемы:

1. Проверьте логи: `docker compose logs bot`
2. Проверьте статус: `docker compose ps`
3. Создайте issue в репозитории с описанием проблемы и логами

---

## 📝 Чеклист Развёртывания

После развёртывания убедитесь:

- [ ] Все контейнеры запущены и healthy
- [ ] База данных создана и миграции выполнены
- [ ] Бот отвечает на `/start` в личных сообщениях
- [ ] Бот работает в группах
- [ ] .env.local защищён (chmod 600)
- [ ] Настроены автоматические бэкапы
- [ ] Токен бота НЕ скомпрометирован
- [ ] Логи пишутся корректно
- [ ] Volumes созданы и используются
- [ ] Нет ошибок в логах при старте
