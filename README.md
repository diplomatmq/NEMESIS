# 🏰 NEMESIS - Tower Game

Telegram RPG игра с адаптивным AI, системой оплаты Telegram Stars и мини-приложением.

## 🎮 Особенности

- 🏰 **500 этажей башни** - каждый этаж новое испытание
- ⚔️ **Боевая система** - атака, защита, критические удары, lifesteal
- 🎭 **8 уникальных классов** - Берсерк, Страж, Ассасин, Вампир, Арканист, Тактик, Шут, Некромант
- 🤖 **Адаптивный AI** - противники изучают ваш стиль игры и адаптируются
- 👹 **Боссы каждые 10 этажей** - уникальные противники с увеличенными характеристиками
- ⏳ **Cooldown система** - 10 минут между действиями
- ⭐ **Telegram Stars** - пропуск cooldown за 1 Star
- 💰 **Система лута** - враги дают золото и предметы
- 🎒 **Инвентарь и экипировка** - собирайте и носите предметы
- 🏆 **Редкость предметов** - Common, Uncommon, Rare, Epic, Legendary, Mythic
- 📊 **Сезонная система** - новый сезон каждый месяц
- 🗺️ **Разнообразные события** - сокровища, торговцы, испытания
- 📈 **Прогрессия** - checkpoint каждые 10 этажей
- 🎮 **Мини-приложение** - полноценная игра внутри Telegram (Emberspire/Ebashnya)

## 📋 Требования

- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Python 3.8+ (для мини-приложения)
- Telegram Bot Token

## 🚀 Установка

### Вариант 1: Docker (Рекомендуется) 🐳

**Самый простой способ!** Всё запускается одной командой.

```bash
# 1. Клонировать репозиторий
git clone <repository-url>
cd NEMESIS

# 2. Настроить .env.local с реальными секретами
cp .env.local.example .env.local
nano .env.local
# Заполните:
# - BOT_TOKEN (из @BotFather)
# - DB_PASSWORD (надёжный пароль!)
# - WEBAPP_URL (публичный https URL мини-приложения)
# - APP_NAME (короткое имя из @BotFather для Mini App)

# 3. Создать симлинк или переименовать для Docker Compose
ln -sf .env.local .env

# 4. Запустить всё (PostgreSQL + Redis + Bot + MiniApp)
docker-compose up -d

# 5. Проверить логи
docker-compose logs -f bot
docker-compose logs -f miniapp
```

Готово! Бот и мини-приложение работают! 🎉

**База данных создаётся автоматически при первом запуске!**

📚 Подробная документация:
- [DATABASE_MANAGEMENT.md](DATABASE_MANAGEMENT.md) - управление базой данных, бэкапы, восстановление
- [SECURITY.md](SECURITY.md) - безопасность, замена токенов, защита секретов

---

### Вариант 2: Локальная установка

Требуется: Node.js 18+, PostgreSQL 14+, Redis 6+, Python 3.8+

### 1. Клонировать репозиторий

```bash
git clone <repository-url>
cd NEMESIS
```

### 2. Установить зависимости

```bash
npm install
```

### 3. Настроить переменные окружения

⚠️ **ВАЖНО:** Никогда не коммитьте `.env` или `.env.local` в Git!

Создайте файл `.env.local` на основе `.env.example`:

```bash
cp .env.example .env.local
```

Заполните следующие переменные:

```env
# Получите токен у @BotFather в Telegram
BOT_TOKEN=YOUR_BOT_TOKEN_FROM_BOTFATHER
BOT_USERNAME=your_bot_username

# PostgreSQL
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/nemesis_game
DB_PASSWORD=YOUR_PASSWORD

# Redis
REDIS_URL=redis://localhost:6379

# Mini App Configuration
WEBAPP_URL=https://your-domain.com
APP_NAME=game
MINIAPP_PORT=8080

# Game settings
COOLDOWN_MINUTES=5
STARS_PRICE=1

# Admin IDs (comma-separated)
ADMIN_IDS=YOUR_TELEGRAM_ID
```

**Генерация безопасного пароля:**
```bash
openssl rand -base64 32
```

### 4. Создать базу данных

База данных будет создана автоматически при первом запуске миграций.

Или создайте вручную:

```bash
# Подключитесь к PostgreSQL
psql -U postgres

# Создайте базу данных
CREATE DATABASE nemesis_game OWNER postgres;
\q
```

### 5. Запустить миграции

```bash
npm run build
npm run migrate
```

### 6. Запустить бота

**Для разработки (с hot-reload):**

```bash
npm run dev
```

**Для продакшена:**

```bash
npm start
```

---

## 🐳 Docker

Для запуска с Docker см. [DOCKER.md](DOCKER.md)

Быстрая команда:
```bash
docker-compose up -d --build
```

## 🎯 Игровые команды

### В личном чате с ботом:
- `/start` - Регистрация в игре (обязательно для начала!)
- `/admin` - Админ-панель с доступом к мини-приложению (только для администраторов)

### В групповом чате:
- `/class` или `/класс` - Выбрать класс (только в начале сезона)
- `атака` или `attack` или `a` - Атаковать противника
- `защита` или `defend` или `d` - Защититься от атаки
- `/status` или `/статус` - Посмотреть свой прогресс
- `/inventory` или `/инвентарь` - Открыть инвентарь

### Админские команды:
- `/sstart` - Запустить новый сезон (выбор между чат-игрой, мини-приложением или обоими)
- `/admin` - Админ-панель с кнопкой входа в мини-приложение
- `/dbstats` - Статистика базы данных
- `/top` - Топ игроков

## 💰 Система оплаты

### Как работает пропуск cooldown:

1. Игрок выполняет действие (атака/защита)
2. Ставится cooldown 10 минут
3. Если игрок пытается действовать до истечения cooldown:
   - Бот показывает сообщение с оставшимся временем
   - Кнопка "⭐ Оплатить 1 Telegram Star"
4. При нажатии открывается Telegram платёж
5. После оплаты действие выполняется автоматически
6. Ставится новый cooldown 10 минут

### Важно:
- Платёж идемпотентен (повторная обработка невозможна)
- Payload привязан к конкретному действию
- После оплаты действие выполняется автоматически
- Не нужно повторно вводить команду

## 🏗️ Архитектура

```
src/
├── bot/                    # Telegram bot handlers
│   ├── handlers/
│   │   ├── start.ts       # /start command
│   │   ├── game.ts        # Game actions
│   │   ├── admin.ts       # Admin commands
│   │   └── payment.ts     # Payment processing
│   └── keyboards/         # Inline keyboards
│
├── game/                   # Game logic
│   ├── GameService.ts     # Main game service
│   ├── CombatEngine.ts    # Combat calculations
│   ├── CooldownService.ts # Cooldown management
│   ├── SeasonService.ts   # Season management
│   └── ...
│
├── payment/               # Payment system
│   ├── InvoiceService.ts  # Invoice creation
│   └── PaymentService.ts  # Payment validation
│
├── database/              # Database layer
│   ├── models/           # Data models
│   ├── migrations/       # SQL migrations
│   ├── db.ts            # PostgreSQL client
│   └── redis.ts         # Redis client
│
├── config/               # Configuration
└── types/                # TypeScript types

app/
└── ebashnya/             # Mini App (Python)
    ├── app/
    │   ├── server.py     # Python HTTP server
    │   ├── public/       # Frontend assets
    │   └── cards/        # Generated card images
    ├── config/           # Configuration files
    └── Dockerfile.miniapp
```

## 🎮 Мини-приложение (Emberspire/Ebashnya)

Мини-приложение работает как отдельный Python сервер и **использует ту же PostgreSQL базу данных**, что и основной бот. Таблицы мини-приложения имеют префикс `app_` чтобы избежать конфликтов.

**Архитектура:**
- 🤖 **Основной бот** → PostgreSQL (таблицы: `users`, `chats`, `player_progress`, ...)
- 🎮 **Мини-приложение** → PostgreSQL (таблицы: `app_players`, `app_raids`, `app_saves`, ...)
- 🗄️ **Одна база данных** → Упрощённые бэкапы, единое место хранения

Интеграция с основным ботом:

- **Аутентификация**: Telegram WebApp initData валидируется с BOT_TOKEN
- **Запуск вместе**: Docker Compose запускает оба сервиса одновременно
- **Общая БД**: PostgreSQL с разделением через префиксы таблиц
- **Админ доступ**: Команда `/admin` предоставляет кнопку входа в мини-приложение
- **Сезоны**: При запуске нового сезона можно выбрать платформу (чат/апп/оба)

### Настройка мини-приложения:

1. Создайте Mini App в @BotFather командой `/newapp`
2. Укажите публичный HTTPS URL в `WEBAPP_URL`
3. Короткое имя приложения укажите в `APP_NAME`
4. Мини-приложение будет доступно через кнопку в боте

📚 Подробнее: [SHARED_DATABASE.md](SHARED_DATABASE.md) - Архитектура общей базы данных

## 🗄️ База данных

### Основные таблицы:

- `users` - Пользователи Telegram
- `chats` - Telegram чаты
- `seasons` - Игровые сезоны
- `player_progress` - Прогресс игрока (уникальный для каждого чата)
- `cooldowns` - Активные cooldowns
- `enemies` - Противники и боссы
- `items` - Игровые предметы
- `pending_payments` - Ожидающие оплату действия
- `payments` - История платежей
- `behavior_profiles` - AI профили игроков

## 🔧 Разработка

### Структура cooldown системы:

```typescript
1. Проверка cooldown
2. Если активен:
   - Создать pending_payment
   - Создать invoice
   - Показать кнопку оплаты
3. При оплате:
   - Валидация платежа
   - Выполнение сохранённого действия
   - Установка нового cooldown
```

### Добавление новых классов:

```sql
INSERT INTO classes (name, code, icon, description, base_hp, base_attack, base_defense)
VALUES ('Берсерк', 'berserker', '⚔️', 'Мастер ближнего боя', 120, 15, 3);
```

### Добавление противников:

```sql
INSERT INTO enemies (name, level, hp, attack, defense, floor_range_min, floor_range_max)
VALUES ('Страж Врат', 5, 200, 25, 10, 40, 50);
```

## 🐛 Отладка

Логи содержат:
- SQL запросы с временем выполнения
- Информацию о платежах
- Ошибки бота

## 📝 TODO (будущие улучшения)

- [ ] Система торговли с NPC
- [ ] Полноценные испытания и челленджи
- [ ] Крафтинг предметов
- [ ] PvP арена
- [ ] Гильдии
- [ ] Рейтинговые бои
- [ ] Ежедневные задания
- [ ] Достижения и титулы (частично готово)
- [ ] NFT интеграция
- [ ] Улучшение предметов
- [ ] Система питомцев
- [ ] Больше уникальных боссов с механиками

## 📄 Лицензия

MIT

## 🤝 Поддержка

Для вопросов и предложений создавайте Issues в репозитории.
