# 🗑️ Инструкции по Полной Очистке БД

## ⚠️ КРИТИЧЕСКОЕ ПРЕДУПРЕЖДЕНИЕ

**Эти команды удаляют ВСЕ данные игры без возможности восстановления!**

Используйте их ТОЛЬКО если:
- Вы хотите начать с нуля
- У вас есть резервная копия данных (или они вам не нужны)
- Вы точно понимаете последствия

---

## 📋 Варианты Очистки

### 🔥 Вариант 1: Полная очистка (Удаление Docker Volumes)

**Что удаляется:**
- ✅ База данных PostgreSQL (ВСЕ таблицы и данные)
- ✅ Данные Redis (кэш, сессии)
- ✅ Docker volumes
- ✅ История миграций

**НЕ удаляется:**
- ✅ Исходный код
- ✅ Конфигурация (.env.local)
- ✅ Резервные копии (backups/)

```bash
cd /opt/bots/NEMESIS

# 1. Остановить все контейнеры
docker compose down

# 2. Удалить volumes (ВСЕ ДАННЫЕ БУДУТ ПОТЕРЯНЫ!)
docker volume rm nemesis_postgres_data
docker volume rm nemesis_redis_data

# 3. Проверить что volumes удалены
docker volume ls | grep nemesis
# Должно быть пусто

# 4. Запустить заново (создаст чистую БД)
docker compose up -d

# 5. Проверить логи
docker compose logs -f bot
```

**Результат:** Свежая установка с пустой БД, все таблицы будут созданы заново.

---

### 🧹 Вариант 2: Очистка только PostgreSQL (Сохранить Redis)

**Что удаляется:**
- ✅ База данных PostgreSQL
- ❌ Данные Redis (сохраняются)

```bash
cd /opt/bots/NEMESIS

# 1. Остановить контейнеры
docker compose down

# 2. Удалить только PostgreSQL volume
docker volume rm nemesis_postgres_data

# 3. Запустить снова
docker compose up -d

# 4. Проверить логи
docker compose logs -f bot
```

---

### 🎯 Вариант 3: Пересоздать только базу данных (Быстро)

**Что удаляется:**
- ✅ База данных `nemesis_game`
- ❌ Docker volumes (сохраняются)
- ❌ PostgreSQL система (сохраняется)

```bash
cd /opt/bots/NEMESIS

# 1. Остановить бота
docker compose stop bot

# 2. Подключиться к PostgreSQL
docker exec -it nemesis_postgres psql -U postgres

# 3. В psql выполнить:
DROP DATABASE IF EXISTS nemesis_game;
CREATE DATABASE nemesis_game OWNER postgres;
\q

# 4. Запустить бота (миграции выполнятся автоматически)
docker compose start bot

# 5. Проверить логи
docker compose logs -f bot
```

**Результат:** База данных пересоздана, но PostgreSQL volume остаётся.

---

### 🧼 Вариант 4: Очистить таблицы (Сохранить структуру)

**Что удаляется:**
- ✅ Данные из всех таблиц
- ❌ Структура таблиц (сохраняется)
- ❌ История миграций (сохраняется)

```bash
cd /opt/bots/NEMESIS

# 1. Остановить бота
docker compose stop bot

# 2. Подключиться к базе данных
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game

# 3. Выполнить очистку таблиц (в psql):
TRUNCATE TABLE 
    users, 
    chats, 
    player_progress, 
    cooldowns, 
    pending_payments, 
    payments, 
    behavior_profiles,
    achievement_progress,
    player_items,
    player_equipment,
    player_souls,
    pending_soul_sacrifices
CASCADE;

\q

# 4. Запустить бота
docker compose start bot
```

**Результат:** Все данные удалены, но структура таблиц осталась.

---

### 🔄 Вариант 5: Полная переустановка (включая образы)

**Что удаляется:**
- ✅ Все контейнеры
- ✅ Все volumes
- ✅ Docker образы
- ✅ Кэш сборки

```bash
cd /opt/bots/NEMESIS

# 1. Остановить и удалить всё
docker compose down -v --rmi all

# 2. Очистить кэш Docker (опционально)
docker system prune -a --volumes

# 3. Пересобрать и запустить
docker compose up -d --build

# 4. Проверить логи
docker compose logs -f bot
```

**Результат:** Полностью чистая установка, как будто проект запускается впервые.

---

## 💾 Создание Резервной Копии Перед Очисткой

**НАСТОЯТЕЛЬНО РЕКОМЕНДУЕТСЯ** создать бэкап перед любой очисткой:

```bash
# Автоматический бэкап (используйте скрипт)
cd /opt/bots/NEMESIS
./scripts/backup.sh

# Или ручной бэкап
docker exec nemesis_postgres pg_dump -U postgres nemesis_game | gzip > "backup_before_cleanup_$(date +%Y%m%d_%H%M%S).sql.gz"
```

---

## 🔍 Проверка Состояния После Очистки

```bash
# 1. Проверить контейнеры
docker compose ps

# 2. Проверить volumes
docker volume ls | grep nemesis

# 3. Проверить логи бота
docker compose logs --tail=50 bot

# 4. Проверить базу данных
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game -c "\dt"

# 5. Проверить данные
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game -c "
    SELECT 
        (SELECT COUNT(*) FROM users) as users_count,
        (SELECT COUNT(*) FROM player_progress) as progress_count,
        (SELECT COUNT(*) FROM items) as items_count,
        (SELECT COUNT(*) FROM enemies) as enemies_count;
"
```

**Ожидаемый результат после полной очистки:**
```
 users_count | progress_count | items_count | enemies_count 
-------------+----------------+-------------+---------------
           0 |              0 |         N>0 |          N>0
```

Items и enemies должны быть заполнены seed данными из миграций.

---

## 🆘 Восстановление После Очистки

Если очистка прошла не так, как планировалось:

### Из резервной копии:

```bash
cd /opt/bots/NEMESIS

# Восстановить из бэкапа
./scripts/restore.sh backups/nemesis_backup_YYYYMMDD_HHMMSS.sql.gz

# Или с пересозданием базы
./scripts/restore.sh --drop-database backups/nemesis_backup_YYYYMMDD_HHMMSS.sql.gz
```

### Если бэкапа нет:

```bash
# Пересоздать с нуля (выполнятся все миграции)
docker compose down -v
docker compose up -d
docker compose logs -f bot
```

---

## 📝 Чеклист Перед Очисткой

Перед выполнением команд очистки убедитесь:

- [ ] Создан свежий бэкап (`./scripts/backup.sh`)
- [ ] Вы понимаете какой вариант очистки используете
- [ ] Бот не находится в процессе важной операции
- [ ] Нет активных пользователей (или они предупреждены)
- [ ] У вас есть доступ к @BotFather (на случай проблем)
- [ ] Вы находитесь в правильной директории (`/opt/bots/NEMESIS`)
- [ ] У вас есть права для выполнения docker команд

---

## 🔁 Пошаговая Процедура Рекомендуемой Очистки

**Для полного сброса игры с сохранением бэкапа:**

```bash
cd /opt/bots/NEMESIS

echo "Шаг 1: Создание резервной копии..."
./scripts/backup.sh

echo "Шаг 2: Остановка контейнеров..."
docker compose down

echo "Шаг 3: Удаление volumes..."
docker volume rm nemesis_postgres_data nemesis_redis_data

echo "Шаг 4: Проверка удаления..."
docker volume ls | grep nemesis

echo "Шаг 5: Запуск с чистой БД..."
docker compose up -d

echo "Шаг 6: Ожидание запуска..."
sleep 10

echo "Шаг 7: Проверка логов..."
docker compose logs --tail=50 bot

echo "Шаг 8: Проверка базы данных..."
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game -c "\dt"

echo "✅ Очистка завершена! База данных пересоздана с нуля."
```

Сохраните эти команды в скрипт для удобства:

```bash
# Создать скрипт
cat > scripts/clean_and_reset.sh << 'EOF'
#!/bin/bash
# [вставьте команды выше]
EOF

chmod +x scripts/clean_and_reset.sh
./scripts/clean_and_reset.sh
```

---

## ❓ FAQ

**Q: Нужно ли удалять Docker volumes каждый раз при перезапуске?**  
A: НЕТ! Volumes нужны для сохранения данных. Удаляйте их только если хотите полностью очистить БД.

**Q: Что произойдёт с данными игроков?**  
A: После очистки все данные игроков будут удалены. Игрокам нужно будет начать заново.

**Q: Можно ли восстановить данные после удаления volumes?**  
A: Только из резервной копии. Без бэкапа данные потеряны навсегда.

**Q: Как часто нужно делать бэкапы?**  
A: Рекомендуется ежедневно (настроить через cron). Минимум - перед каждым важным изменением.

**Q: Будут ли работать старые команды после очистки?**  
A: Да, вся логика бота сохраняется. Просто база данных пустая.

**Q: Нужно ли менять .env.local после очистки?**  
A: Нет, конфигурация остаётся прежней.

---

## 📞 Поддержка

Если возникли проблемы после очистки:

1. Проверьте логи: `docker compose logs bot`
2. Проверьте БД: `docker exec -it nemesis_postgres psql -U postgres -d nemesis_game`
3. Попробуйте пересоздать: `docker compose down -v && docker compose up -d`
4. Восстановите из бэкапа: `./scripts/restore.sh backups/latest_backup.sql.gz`
