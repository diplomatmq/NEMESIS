# 📝 Конфигурация мини-приложения

## ⚠️ Важно

**Файл `emberspire.env.example` удалён!**

Теперь все переменные окружения берутся из **корневого `.env` файла** проекта.

## 🔧 Где настраивать?

Все переменные окружения для мини-приложения находятся в:

```
/NEMESIS/.env.local  (или .env)
```

**НЕ создавайте отдельный .env файл в этой папке!**

## 📋 Необходимые переменные

См. корневой файл `.env.example` в проекте.

### Минимальный набор:

```env
# Основные (обязательны)
BOT_TOKEN=your_bot_token_here
DB_PASSWORD=your_secure_password
WEBAPP_URL=https://your-domain.com
APP_NAME=game

# Опциональные (имеют значения по умолчанию)
MINIAPP_PORT=8080
CHANNEL=
SUPPORT_URL=
STARS_TEST=0
AC_TZ=3
AC_DIGEST_HOUR=12
REMIND_GAP_H=8
REMIND_AWAY_MIN=30
ADMIN_IDS=678418106,793216884
```

## 🐳 Docker

Docker Compose автоматически передаёт переменные из корневого `.env` в контейнер мини-приложения.

См. `docker-compose.yml` секцию `miniapp.environment`

## 🚀 Локальная разработка

При локальном запуске Python сервера переменные читаются из корневого `.env`:

```bash
# Из корня проекта
python app/ebashnya/app/server_postgres.py
```

Python автоматически подхватывает переменные из `.env` через `os.environ.get()`

## 📁 Файлы в этой папке

- `Caddyfile` - конфигурация reverse proxy (для продакшна)
- `90-bbr.conf` - оптимизация сети (опционально)
- `emberspire.service` - systemd service (для продакшна без Docker)
- `README.md` - этот файл

## 🔗 Связь с основным ботом

Мини-приложение использует те же настройки что и основной бот:
- Тот же `BOT_TOKEN` для валидации
- Та же PostgreSQL база (`DB_HOST`, `DB_PASSWORD`, `DB_NAME`)
- Те же `ADMIN_IDS`

Разделение данных обеспечивается префиксом `app_` для таблиц мини-приложения.

## 📚 Дополнительно

См. документацию:
- `/NEMESIS/SHARED_DATABASE.md` - архитектура общей БД
- `/NEMESIS/MINIAPP_SETUP.md` - подробная настройка
- `/NEMESIS/README.md` - основная документация
