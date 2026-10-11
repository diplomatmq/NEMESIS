# ⚡ Быстрый Старт NEMESIS

## 🎯 Для того, кто хочет быстро запустить бота

### На Сервере (Production)

```bash
cd /opt/bots/NEMESIS

# 1. Создать .env.local
cat > .env.local << 'EOF'
BOT_TOKEN=ВАШ_НОВЫЙ_ТОКЕН_ИЗ_BOTFATHER
BOT_USERNAME=nemesis_robot
DATABASE_URL=postgresql://postgres:НАДЁЖНЫЙ_ПАРОЛЬ@postgres:5432/nemesis_game
DB_HOST=postgres
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=НАДЁЖНЫЙ_ПАРОЛЬ
DB_NAME=nemesis_game
REDIS_URL=redis://redis:6379
REDIS_HOST=redis
REDIS_PORT=6379
COOLDOWN_MINUTES=10
STARS_PRICE=1
PORT=3000
NODE_ENV=production
EOF

# 2. Защитить секреты
chmod 600 .env.local
ln -sf .env.local .env

# 3. Запустить
docker compose up -d

# 4. Проверить логи
docker compose logs -f bot
```

**Готово!** База создастся автоматически при первом запуске.

---

## 🗑️ Удалить ВСЕ базы данных (начать с нуля)

```bash
cd /opt/bots/NEMESIS

# ⚠️ ВНИМАНИЕ: Это удалит ВСЕ данные без возможности восстановления!

# 1. Создать бэкап на всякий случай
./scripts/backup.sh

# 2. Остановить контейнеры
docker compose down

# 3. Удалить volumes (БД PostgreSQL и Redis)
docker volume rm nemesis_postgres_data nemesis_redis_data

# 4. Убедиться что volumes удалены
docker volume ls | grep nemesis
# Должно быть пусто

# 5. Запустить с чистой БД
docker compose up -d

# 6. Проверить что всё создалось заново
docker compose logs -f bot
```

**Результат:** Совершенно чистая база данных, как будто бот запускается впервые.

---

## 🔄 Перезапустить без удаления данных

```bash
cd /opt/bots/NEMESIS

# Просто перезапустить
docker compose restart

# ИЛИ остановить и запустить
docker compose down
docker compose up -d
```

**Данные сохранятся!** Команда `down` без `-v` НЕ удаляет volumes.

---

## 🆘 Проблемы?

### Бот не запускается

```bash
docker compose logs bot
```

### База не создаётся

```bash
docker exec -it nemesis_postgres psql -U postgres -c "CREATE DATABASE nemesis_game OWNER postgres;"
docker compose restart bot
```

### Нужна помощь

Смотрите:
- `DATABASE_MANAGEMENT.md` - управление БД
- `SECURITY.md` - безопасность
- `CLEANUP_INSTRUCTIONS.md` - полная очистка
- `DEPLOYMENT.md` - развёртывание

---

## ✅ Чеклист После Запуска

- [ ] Все контейнеры запущены: `docker compose ps`
- [ ] Логи без ошибок: `docker compose logs bot`
- [ ] Бот отвечает на `/start` в Telegram
- [ ] .env.local защищён: `ls -la .env.local` (должно быть `-rw-------`)
