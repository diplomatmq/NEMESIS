# Запуск Python бота с PostgreSQL

Python бот нужно запустить через `server_postgres.py` чтобы он использовал ту же БД что и TypeScript бот!

## Запуск:

```bash
cd app/ebashnya/app
python3 server_postgres.py
```

Или добавь в `.env`:
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=nemesis_game
```

И запусти:
```bash
cd app/ebashnya/app
python3 server_postgres.py
```

## Проверка:

После запуска должно быть:
```
🔌 Using PostgreSQL database
✅ PostgreSQL adapter loaded: localhost:5432/nemesis_game
```

Если видишь `📁 Using SQLite database` - значит переменные окружения не подтянулись!
