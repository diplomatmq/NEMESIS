# 🚀 Быстрый старт NEMESIS

## Пошаговая инструкция для запуска

### 1️⃣ Предварительные требования

Убедитесь, что установлены:
- **Node.js 18+** - [Скачать](https://nodejs.org/)
- **Docker Desktop** (для PostgreSQL и Redis) - [Скачать](https://www.docker.com/products/docker-desktop/)

### 2️⃣ Получить Telegram Bot Token

1. Откройте Telegram и найдите [@BotFather](https://t.me/BotFather)
2. Отправьте команду `/newbot`
3. Следуйте инструкциям для создания бота
4. Сохраните полученный **Bot Token**
5. Отправьте `/mybots` → выберите своего бота → **Bot Settings** → **Payments**
6. Выберите провайдера **Telegram Stars** (XTR)

### 3️⃣ Установка

```powershell
# Установить зависимости
npm install
```

### 4️⃣ Настройка окружения

Создайте файл `.env` в корне проекта:

```env
# Ваш токен бота
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
BOT_USERNAME=your_bot_username_bot

# База данных (для Docker по умолчанию)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nemesis_game
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=nemesis_game

# Redis (для Docker по умолчанию)
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# Игровые настройки
COOLDOWN_MINUTES=10
STARS_PRICE=1
```

### 5️⃣ Запуск базы данных

```powershell
# Запустить PostgreSQL и Redis через Docker
docker-compose up -d

# Проверить что контейнеры запущены
docker-compose ps
```

Должно показать:
```
NAME                IMAGE                  STATUS
nemesis_postgres    postgres:15-alpine     Up
nemesis_redis       redis:7-alpine         Up
```

### 6️⃣ Создание схемы базы данных

```powershell
# Собрать проект
npm run build

# Запустить миграции
npm run migrate
```

Должно показать:
```
✅ Schema created
✅ Seed data inserted
✅ Database migrations completed successfully!
```

### 7️⃣ Запуск бота

**Для разработки (с hot-reload):**

```powershell
npm run dev
```

**Для продакшена:**

```powershell
npm start
```

Должно показать:
```
🤖 NEMESIS Tower Game Bot starting...
🔌 Connecting to Redis...
✅ Redis connected
🔌 Testing database connection...
✅ Database connected
🚀 Starting bot...
✅ Bot is running!
👤 Bot username: @your_bot_username_bot
```

### 8️⃣ Тестирование бота

1. Откройте Telegram
2. Найдите вашего бота по username
3. Отправьте `/start` в личном чате
4. Добавьте бота в групповой чат
5. В группе напишите: `атака`
6. Бот ответит результатом боя!

## 🎮 Первая игра

### В личном чате:
```
/start
```

Вы зарегистрированы!

### В групповом чате:
```
атака
```

Бот выполнит атаку и поставит cooldown 10 минут.

Если попытаться атаковать снова:
```
атака
```

Бот предложит оплатить 1 Telegram Star для пропуска cooldown.

## 🛠️ Полезные команды

```powershell
# Остановить базы данных
docker-compose down

# Перезапустить базы данных
docker-compose restart

# Посмотреть логи
docker-compose logs -f

# Очистить всё (включая данные!)
docker-compose down -v
```

## ❓ Проблемы?

### Бот не запускается

**Ошибка:** `BOT_TOKEN is not set`
- Проверьте файл `.env`
- Убедитесь что токен правильный

**Ошибка:** `Database connection failed`
- Убедитесь что Docker запущен: `docker-compose ps`
- Проверьте подключение: `docker-compose logs postgres`

**Ошибка:** `Redis connection failed`
- Проверьте Redis: `docker-compose logs redis`

### База данных не работает

```powershell
# Пересоздать контейнеры
docker-compose down -v
docker-compose up -d

# Подождать 10 секунд

# Запустить миграции заново
npm run migrate
```

## 📚 Что дальше?

- Прочитайте [README.md](README.md) для полной документации
- Изучите [спецификацию](telegram_tower_game_spec.md) для деталей механик
- Добавьте новых врагов в `002_seed_data.sql`
- Настройте классы и предметы

## 🎉 Готово!

Теперь у вас запущена полнофункциональная Telegram игра NEMESIS!

Приятной игры! 🏰⚔️
