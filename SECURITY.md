# 🔒 Безопасность NEMESIS Bot

## ⚠️ КРИТИЧЕСКОЕ ПРЕДУПРЕЖДЕНИЕ

**Токен вашего Telegram-бота был скомпрометирован!**

Токен `8746148498:AAFbl03VuZxVpxWftLTdlQBY8xB2n6djals` был обнаружен в файле `.env`, который мог быть добавлен в Git или доступен публично.

## 🚨 НЕМЕДЛЕННЫЕ ДЕЙСТВИЯ

### 1. Замените токен бота (СРОЧНО!)

```bash
# 1. Откройте Telegram и найдите @BotFather
# 2. Отправьте команду: /mybots
# 3. Выберите вашего бота (nemesis_robot или другое имя)
# 4. Нажмите "API Token"
# 5. Нажмите "Revoke current token" (Отозвать текущий токен)
# 6. Подтвердите действие
# 7. Скопируйте НОВЫЙ токен
```

### 2. Обновите конфигурацию на сервере

```bash
# На сервере /opt/bots/NEMESIS:

# Создайте .env.local с новым токеном
cat > .env.local << 'EOF'
# Telegram Bot Configuration
BOT_TOKEN=ВАШ_НОВЫЙ_ТОКЕН_ЗДЕСЬ
BOT_USERNAME=nemesis_robot

# Database Configuration
DATABASE_URL=postgresql://postgres:НАДЁЖНЫЙ_ПАРОЛЬ@postgres:5432/nemesis_game
DB_HOST=postgres
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=НАДЁЖНЫЙ_ПАРОЛЬ
DB_NAME=nemesis_game

# Redis Configuration
REDIS_URL=redis://redis:6379
REDIS_HOST=redis
REDIS_PORT=6379

# Game Configuration
COOLDOWN_MINUTES=10
STARS_PRICE=1

# Server Configuration
PORT=3000
NODE_ENV=production
EOF

# Установите правильные права доступа
chmod 600 .env.local
```

### 3. Обновите docker-compose.yml для использования .env.local

Docker Compose автоматически читает `.env` файл. Создайте симлинк:

```bash
# ТОЛЬКО на сервере!
cd /opt/bots/NEMESIS
ln -sf .env.local .env
```

Или измените `docker-compose.yml`:

```yaml
services:
  bot:
    env_file:
      - .env.local  # Использовать .env.local вместо .env
```

### 4. Перезапустите бота с новыми настройками

```bash
cd /opt/bots/NEMESIS

# Остановите бота
docker compose down

# Запустите с новыми настройками
docker compose up -d

# Проверьте логи
docker compose logs -f bot
```

### 5. Удалите старый .env из Git (если он был закоммичен)

```bash
# ВНИМАНИЕ: Это переписывает историю Git!
# Используйте только если .env действительно был в Git

cd /opt/bots/NEMESIS

# Удалить .env из истории Git (используя BFG Repo Cleaner)
# https://rtyley.github.io/bfg-repo-cleaner/

# Или используя git filter-branch (медленнее, но встроено в git)
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch .env' \
  --prune-empty --tag-name-filter cat -- --all

# Форс-пуш изменений (ОПАСНО, координируйте с командой!)
git push origin --force --all
git push origin --force --tags
```

---

## 🛡️ Постоянная защита

### Структура секретов

```
/opt/bots/NEMESIS/
├── .env.example          # Шаблон (в Git) ✅
├── .env.local.example    # Шаблон для сервера (в Git) ✅
├── .env.local            # РЕАЛЬНЫЕ секреты (НЕ в Git) ❌
└── .gitignore            # Защищает .env.local ✅
```

### Проверьте .gitignore

Убедитесь, что в `.gitignore` есть:

```gitignore
# Environment variables
.env
.env.local
.env.*.local
.env.production
.env.development
```

### Проверьте, что секреты не в Git

```bash
# Проверить, отслеживается ли .env.local
git ls-files | grep .env.local

# Если вывод пустой - всё хорошо ✅
# Если показывает файлы - СРОЧНО удалите их из Git!
```

### Генерация безопасных паролей

```bash
# Генерация случайного пароля (32 символа)
openssl rand -base64 32

# Генерация для WEBHOOK_SECRET
openssl rand -hex 32
```

---

## 🔐 Рекомендации по безопасности

### 1. Используйте сильные пароли

```bash
# ❌ ПЛОХО
DB_PASSWORD=postgres
DB_PASSWORD=123456
DB_PASSWORD=password

# ✅ ХОРОШО
DB_PASSWORD=kJ8$mN2#pL9@qR5%tY7^uI3&oP6*aS4
```

### 2. Ограничьте доступ к .env.local

```bash
# Только владелец может читать/писать
chmod 600 /opt/bots/NEMESIS/.env.local

# Проверить права
ls -la /opt/bots/NEMESIS/.env.local
# Должно быть: -rw------- (600)
```

### 3. Регулярно ротируйте секреты

```bash
# Каждые 3-6 месяцев:
# 1. Смените пароль БД
# 2. Обновите токен бота (по желанию)
# 3. Смените WEBHOOK_SECRET если используется
```

### 4. Используйте переменные окружения для CI/CD

Если используете GitHub Actions, GitLab CI или другие:

```yaml
# .github/workflows/deploy.yml
env:
  BOT_TOKEN: ${{ secrets.BOT_TOKEN }}
  DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
```

**Никогда не храните секреты в коде!**

### 5. Аудит безопасности

```bash
# Проверить, что секреты не в Git
git log --all --full-history --source --find-copies-harder -- .env .env.local

# Сканирование на секреты (установите gitleaks)
# https://github.com/gitleaks/gitleaks
gitleaks detect --source /opt/bots/NEMESIS
```

---

## 🔍 Что делать, если секреты утекли

### Telegram Bot Token скомпрометирован

1. **Отзовите токен** через @BotFather (см. выше)
2. **Обновите конфигурацию** на всех серверах
3. **Проверьте логи бота** на подозрительную активность
4. **Удалите токен из Git истории** (если был закоммичен)

### Database Password скомпрометирован

```bash
# 1. Остановите бота
docker compose stop bot

# 2. Подключитесь к PostgreSQL
docker exec -it nemesis_postgres psql -U postgres

# 3. Смените пароль
ALTER USER postgres WITH PASSWORD 'НОВЫЙ_НАДЁЖНЫЙ_ПАРОЛЬ';
\q

# 4. Обновите .env.local с новым паролем
nano .env.local

# 5. Перезапустите всё
docker compose down
docker compose up -d
```

### Webhook Secret скомпрометирован

```bash
# Сгенерируйте новый
openssl rand -hex 32

# Обновите .env.local
# Перезапустите бота
docker compose restart bot
```

---

## 📋 Чеклист безопасности

Перед развёртыванием убедитесь:

- [ ] Токен бота получен от @BotFather и никогда не публиковался
- [ ] Используется сильный пароль для PostgreSQL (не "postgres")
- [ ] .env.local имеет права 600 (только владелец может читать)
- [ ] .env.local НЕ добавлен в Git (проверить: `git ls-files | grep .env.local`)
- [ ] .gitignore содержит все паттерны .env*
- [ ] Старые скомпрометированные секреты удалены из Git истории
- [ ] Бэкапы базы данных хранятся в безопасном месте
- [ ] Доступ к серверу ограничен (SSH keys, firewall)
- [ ] PostgreSQL не доступен из интернета (только localhost или Docker network)
- [ ] Redis не доступен из интернета

---

## 🆘 Контакты для сообщения о проблемах безопасности

Если вы обнаружили уязвимость в NEMESIS:

1. **НЕ создавайте публичный issue**
2. Свяжитесь с разработчиком напрямую
3. Опишите проблему и шаги для воспроизведения
4. Дождитесь подтверждения и исправления

---

## 📚 Дополнительные ресурсы

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [PostgreSQL Security](https://www.postgresql.org/docs/current/security.html)
- [Telegram Bot Security](https://core.telegram.org/bots/api#setwebhook)
