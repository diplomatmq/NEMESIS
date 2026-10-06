# 🏰 NEMESIS - Tower Game

Telegram RPG игра с адаптивным AI и системой оплаты Telegram Stars для пропуска cooldown.

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

## 📋 Требования

- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Telegram Bot Token

## 🚀 Установка

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

Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

Заполните следующие переменные:

```env
BOT_TOKEN=your_bot_token_from_@BotFather
BOT_USERNAME=your_bot_username

DATABASE_URL=postgresql://user:password@localhost:5432/nemesis_game
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=nemesis_game

REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

COOLDOWN_MINUTES=10
STARS_PRICE=1
```

### 4. Создать базу данных

```bash
# Подключитесь к PostgreSQL
psql -U postgres

# Создайте базу данных
CREATE DATABASE nemesis_game;
```

### 5. Запустить миграции

```bash
npm run build
npm run migrate
```

### 6. Запустить бота

Для разработки (с hot-reload):

```bash
npm run dev
```

Для продакшена:

```bash
npm run build
npm start
```

## 🎯 Игровые команды

### В личном чате с ботом:
- `/start` - Регистрация в игре (обязательно для начала!)

### В групповом чате:
- `/class` или `/класс` - Выбрать класс (только в начале сезона)
- `атака` или `attack` или `a` - Атаковать противника
- `защита` или `defend` или `d` - Защититься от атаки
- `/status` или `/статус` - Посмотреть свой прогресс
- `/inventory` или `/инвентарь` - Открыть инвентарь

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
│   │   └── payment.ts     # Payment processing
│   └── keyboards/         # Inline keyboards
│
├── game/                   # Game logic
│   ├── GameService.ts     # Main game service
│   ├── CombatEngine.ts    # Combat calculations
│   ├── CooldownService.ts # Cooldown management
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
```

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
