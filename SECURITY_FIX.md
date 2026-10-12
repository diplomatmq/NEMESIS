# 🔒 SECURITY FIX - Закрытие портов БД

## ⚠️ КРИТИЧЕСКАЯ ПРОБЛЕМА
Порты PostgreSQL (5432) и Redis (6379) были открыты всему интернету через `docker-compose.yml`.

## ✅ ЧТО ИСПРАВЛЕНО

### docker-compose.yml
- ❌ Убрана строка `ports: - "5432:5432"` для PostgreSQL
- ❌ Убрана строка `ports: - "6379:6379"` для Redis
- ✅ Теперь БД и Redis доступны только внутри Docker-сети
- ✅ Бот подключается через внутренние имена хостов: `postgres:5432` и `redis:6379`

### Почему это безопасно:
1. **Внутренняя сеть Docker**: контейнеры общаются через `nemesis_network`
2. **Нет внешнего доступа**: никто извне не может подключиться к БД
3. **Bot работает**: бот внутри Docker-сети имеет доступ
4. **Порт 3000**: открыт только порт бота (если нужен API)

---

## 🗄️ ВОССТАНОВЛЕНИЕ БД

### 1. Запустите Docker Desktop
```
1. Откройте Docker Desktop
2. Дождитесь полного запуска (зелёная галочка)
```

### 2. Проверьте volumes
```bash
docker volume ls | Select-String "nemesis"
```

Должны быть:
- `nemesis_postgres_data`
- `nemesis_redis_data`

### 3. Запустите контейнеры
```bash
cd c:\Users\dip663322o2244\Desktop\практика\NEMESIS
docker compose up -d
```

### 4. Проверьте статус
```bash
docker ps
docker logs nemesis_postgres
docker logs nemesis_bot
```

### 5. Если БД пустая - запустите миграции
```bash
# Зайдите в контейнер бота
docker exec -it nemesis_bot sh

# Запустите миграции
npm run migrate

# Выйдите
exit
```

### 6. Проверьте что БД создана
```bash
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game -c "\dt"
```

Должны увидеть таблицы:
- users
- chats
- seasons
- player_progress
- items
- inventory
- classes
- и др.

---

## 🔄 ЕСЛИ ДАННЫЕ ПОТЕРЯНЫ

### Вариант 1: Есть бэкап
```bash
# Восстановите из бэкапа
docker exec -i nemesis_postgres psql -U postgres -d nemesis_game < backups/backup_YYYY-MM-DD.sql
```

### Вариант 2: Нет бэкапа (чистая БД)
```bash
# 1. Остановите контейнеры
docker compose down

# 2. ОПЦИОНАЛЬНО: Удалите старый volume (если БД сломана)
docker volume rm nemesis_postgres_data

# 3. Запустите заново
docker compose up -d

# 4. Дождитесь запуска PostgreSQL (30 сек)
Start-Sleep -Seconds 30

# 5. Запустите миграции из контейнера
docker exec -it nemesis_bot npm run migrate

# 6. Проверьте БД
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game -c "\dt"
```

---

## 📋 НАСТРОЙКА АВТОБЭКАПОВ

### Создайте папку для бэкапов
```bash
mkdir backups
```

### Добавьте в cron/Task Scheduler (Windows)
```powershell
# Создайте файл backup.ps1
@"
`$date = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
docker exec nemesis_postgres pg_dump -U postgres nemesis_game > "c:\Users\dip663322o2244\Desktop\практика\NEMESIS\backups\backup_`$date.sql"
Write-Host "Backup created: backup_`$date.sql"
"@ | Out-File -FilePath "c:\Users\dip663322o2244\Desktop\практика\NEMESIS\backup.ps1"

# Запустите через Task Scheduler каждый день
```

### Или используйте скрипт вручную:
```bash
# Из PowerShell
$date = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
docker exec nemesis_postgres pg_dump -U postgres nemesis_game > "backups/backup_$date.sql"
```

---

## 🚨 ВАЖНЫЕ КОМАНДЫ

### Проверка что порты закрыты
```bash
# Снаружи Docker не должно быть 5432 и 6379
netstat -an | Select-String "5432|6379"

# Или проверьте через Docker
docker port nemesis_postgres
docker port nemesis_redis
# Должно быть пусто!
```

### Подключение к БД (только внутри Docker)
```bash
# Работает только внутри контейнера
docker exec -it nemesis_postgres psql -U postgres -d nemesis_game

# Извне НЕ работает (это правильно!)
psql -h localhost -U postgres -d nemesis_game
# Connection refused - ЭТО ХОРОШО!
```

### Логи контейнеров
```bash
docker logs nemesis_postgres --tail 50
docker logs nemesis_redis --tail 50
docker logs nemesis_bot --tail 100 -f
```

---

## ✅ CHECKLIST

- [x] Порт 5432 закрыт (PostgreSQL)
- [x] Порт 6379 закрыт (Redis)
- [ ] Docker Desktop запущен
- [ ] Контейнеры запущены (`docker compose up -d`)
- [ ] Миграции выполнены (`docker exec -it nemesis_bot npm run migrate`)
- [ ] Бот работает (проверить логи)
- [ ] Создать папку `backups/`
- [ ] Настроить автоматические бэкапы

---

## 🔐 ДОПОЛНИТЕЛЬНАЯ БЕЗОПАСНОСТЬ

### 1. Сильный пароль БД
Убедитесь что в `.env.local`:
```env
DB_PASSWORD=очень_сложный_пароль_минимум_20_символов
```

### 2. Firewall
Убедитесь что firewall блокирует входящие подключения на порты 5432, 6379, 3000 (если API не нужен)

### 3. .env.local в .gitignore
Проверьте что `.env.local` в `.gitignore` и НЕ коммитится в Git!

```bash
# Проверка
git status --ignored
# .env.local должен быть в ignored files
```

---

## 📞 КОНТАКТЫ
Если что-то пошло не так:
1. Проверьте логи: `docker logs nemesis_bot`
2. Проверьте БД: `docker exec -it nemesis_postgres psql -U postgres -d nemesis_game -c "\dt"`
3. Пересоздайте volume если нужно (см. "Вариант 2" выше)
