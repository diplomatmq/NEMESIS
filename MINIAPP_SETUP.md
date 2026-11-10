# 🎮 Настройка Мини-приложения (Emberspire/Ebashnya)

Мини-приложение работает как отдельный Python сервер параллельно с основным Telegram ботом.

## 📋 Требования

- Python 3.8+
- Pillow (python3-pil) - опционально, для генерации карточек
- Публичный HTTPS домен (требование Telegram для Mini Apps)

## 🚀 Быстрый старт с Docker

Мини-приложение автоматически запускается вместе с основным ботом:

```bash
# 1. Настройте переменные окружения в .env.local
WEBAPP_URL=https://your-domain.com
APP_NAME=game
MINIAPP_PORT=8080
ADMIN_IDS=678418106,793216884

# 2. Запустите всё через Docker Compose
docker-compose up -d

# 3. Проверьте логи мини-приложения
docker-compose logs -f miniapp
```

## 🔧 Настройка в @BotFather

1. Откройте диалог с @BotFather в Telegram
2. Выполните команду `/newapp`
3. Выберите вашего бота
4. Укажите название (Short name): например, `game`
5. Укажите описание приложения
6. Загрузите иконку 640x360 (опционально)
7. Загрузите GIF-превью (опционально)
8. **Укажите URL мини-приложения**: `https://your-domain.com`

Готово! Короткое имя приложения укажите в `APP_NAME` в `.env.local`

## 🏗️ Архитектура

```
app/ebashnya/
├── app/
│   ├── server.py          # Python HTTP сервер (порт 8080)
│   ├── public/            # Статические файлы фронтенда
│   │   ├── index.html     # Главная страница игры
│   │   ├── a/             # JavaScript bundle
│   │   └── music/         # Музыка игры
│   ├── cards/             # Генерируемые карточки для шаринга
│   └── duel_engine.js     # Игровая логика дуэлей
├── config/
│   ├── Caddyfile          # Конфигурация reverse proxy
│   └── emberspire.env.example
└── Dockerfile.miniapp     # Docker образ для Python сервера
```

## 🔐 Безопасность

### Аутентификация через Telegram

Мини-приложение валидирует `initData` от Telegram используя `BOT_TOKEN`:

1. Telegram передаёт `initData` при открытии мини-приложения
2. Python сервер проверяет HMAC подпись с использованием `BOT_TOKEN`
3. Если подпись валидна - пользователь аутентифицирован
4. Данные пользователя (id, username, first_name) доступны в `initData`

### Проверка админов

Админские функции (например, вызов босса в чате) доступны только ID из `ADMIN_IDS`:

```python
ADMIN_IDS = {int(x) for x in os.environ.get("ADMIN_IDS", "678418106").replace(" ", "").split(",") if x}

if user_id in ADMIN_IDS:
    # Admin functionality
```

## 📊 База данных

Мини-приложение использует **ту же PostgreSQL базу данных**, что и основной бот:

- Файл: **Общая PostgreSQL** (не SQLite!)
- Таблицы: Префикс `app_` (например, `app_players`, `app_raids`)
- Изоляция: Префиксы гарантируют отсутствие конфликтов с основным ботом
- Миграция: `044_miniapp_tables.sql` создаёт все необходимые таблицы

**Важно:** Это **та же база данных** PostgreSQL, которую использует основной бот! Префикс `app_` обеспечивает разделение данных.

### Как это работает?

Python сервер использует **адаптер** (`db_adapter.py`), который:
1. Предоставляет SQLite-подобный интерфейс для совместимости
2. Автоматически добавляет префикс `app_` ко всем таблицам
3. Конвертирует SQL из SQLite синтаксиса в PostgreSQL
4. Подключается к той же PostgreSQL что и бот

```python
# В коде мини-приложения
db.execute("SELECT * FROM players WHERE id=?", (user_id,))

# Реально выполняется в PostgreSQL
# SELECT * FROM app_players WHERE id=%s
```

📚 Подробнее: [SHARED_DATABASE.md](../SHARED_DATABASE.md)

## 🎮 Функции мини-приложения

1. **Полноценная tower defense игра** - игра в браузере внутри Telegram
2. **Raid боссы** - групповые рейды на боссов в чатах
3. **Дуэли** - PvP сражения между игроками
4. **Друзья и рефералы** - система приглашений
5. **Лидерборды** - топ игроков глобальный и по классам
6. **Сохранения в облаке** - прогресс синхронизируется
7. **Напоминания об отдыхе** - бот напоминает когда отдых закончился

## 🔗 Интеграция с основным ботом

### Команда `/admin`

Админы могут получить прямую ссылку на мини-приложение:

```typescript
bot.command('admin', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  
  await ctx.reply('🔐 Админ-панель', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🎮 Открыть мини-приложение', web_app: { url: WEBAPP_URL }}
      ]]
    }
  });
});
```

### Запуск сезона

При запуске нового сезона можно выбрать платформу:

```
/sstart → Выбор:
- 💬 Чат-игра
- 🎮 Мини-приложение  
- 🌐 Оба варианта
```

Объявление о начале сезона включает ссылку на мини-приложение (если выбран app или both).

## 🌐 Reverse Proxy (продакшн)

Для продакшна рекомендуется использовать Caddy или Nginx:

### Caddy (пример конфигурации уже есть в `config/Caddyfile`):

```
your-domain.com {
    reverse_proxy localhost:8080
    encode gzip
    
    header {
        X-Frame-Options "ALLOW-FROM https://web.telegram.org"
        X-Content-Type-Options "nosniff"
    }
}
```

### Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 📝 Переменные окружения

| Переменная | Описание | Значение по умолчанию |
|------------|----------|----------------------|
| `BOT_TOKEN` | Токен бота (для валидации) | Обязателен |
| `WEBAPP_URL` | Публичный HTTPS URL | Обязателен |
| `APP_NAME` | Короткое имя из @BotFather | `game` |
| `PORT` | Порт Python сервера | `8080` |
| `DB_HOST` | PostgreSQL хост | `postgres` (Docker) |
| `DB_PORT` | PostgreSQL порт | `5432` |
| `DB_NAME` | Название БД | `nemesis_game` |
| `DB_USER` | Пользователь БД | `postgres` |
| `DB_PASSWORD` | Пароль БД | Обязателен |
| `ADMIN_IDS` | ID админов (через запятую) | `678418106` |
| `SUPPORT_URL` | URL канала поддержки | - |
| `REMIND_GAP_H` | Интервал напоминаний (часы) | `8` |
| `REMIND_AWAY_MIN` | Минут неактивности для напоминания | `30` |
| `AC_TZ` | Часовой пояс (UTC offset) | `3` (MSK) |

## 🐛 Отладка

### Проверка работы сервера:

```bash
# Локально
curl http://localhost:8080/

# В Docker
docker-compose exec miniapp python3 -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8080/').read())"
```

### Логи:

```bash
# Docker
docker-compose logs -f miniapp

# Локальная установка
# Логи выводятся в stdout сервера
```

### Типичные проблемы:

1. **"initData validation failed"**
   - Проверьте что `BOT_TOKEN` совпадает с токеном бота
   - Убедитесь что `WEBAPP_URL` настроен правильно в @BotFather

2. **"Failed to connect to miniapp"**
   - Проверьте что порт 8080 открыт
   - Убедитесь что сервер запущен: `docker-compose ps`

3. **База данных не создаётся**
   - Убедитесь что директория `/app/data` существует и доступна для записи
   - Проверьте права на volume: `docker volume inspect nemesis_miniapp_data`

## 📚 Дополнительные ресурсы

- [Telegram Mini Apps Documentation](https://core.telegram.org/bots/webapps)
- [Bot API Documentation](https://core.telegram.org/bots/api)
- [emberspire README](app/ebashnya/README.md) - оригинальная документация

## 🤝 Поддержка

Для вопросов и предложений создавайте Issues в репозитории.
