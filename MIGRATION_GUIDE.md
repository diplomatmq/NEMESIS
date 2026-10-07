# Руководство по миграции - Глобальный прогресс

## Быстрый старт

### 1. Остановите бота (если запущен)
```bash
# Найдите процесс и остановите его
```

### 2. Сделайте резервную копию базы данных
```bash
# PostgreSQL
pg_dump -U your_user -d nemesis_db > backup_$(date +%Y%m%d).sql

# Или через Docker
docker exec -t nemesis-postgres pg_dump -U nemesis nemesis_db > backup_$(date +%Y%m%d).sql
```

### 3. Соберите проект
```bash
npm run build
```

### 4. Запустите миграцию
```bash
npm run migrate
```

Вы должны увидеть:
```
Starting database migrations...
✅ Schema created
✅ Seed data inserted
✅ Achievements created
✅ Global progress migration completed
✅ Database migrations completed successfully!
```

### 5. Запустите бота
```bash
npm start
```

## Что изменилось

### Основные изменения

1. **Глобальный прогресс игрока**
   - Прогресс теперь не привязан к чату
   - Один игрок = один прогресс на сезон
   - Предметы, золото, HP доступны во всех чатах

2. **Боевое состояние (Combat State)**
   - Бой сохраняется между чатами
   - Если начали бой в чате А, продолжите в чате Б

3. **Детерминированная генерация врагов**
   - Все игроки встречают одинаковых врагов на одних этажах
   - Боссы одинаковые для всех

4. **Восстановление HP**
   - HP больше НЕ восстанавливается автоматически
   - Только через `/potion` или при переходе на следующий этаж
   - Зелья выпадают из врагов и боссов

5. **Множественные чаты**
   - Первый чат = 100% наград
   - Дополнительные чаты = 50% наград

### Новые команды

#### `/potion` или `/зелье`
Использовать зелье здоровья

```
/potion
> 🧪 Вы использовали Малое зелье здоровья
> 💚 Восстановлено: 30 HP
> ❤️ Текущее HP: 80/100
```

### Обновленные команды

#### `/status` - теперь показывает:
- Глобальный прогресс (этаж, HP)
- Прогресс в текущем чате
- Текущий бой (если есть)
- Предупреждение о низком HP
- Количество зелий

#### `/inventory` - теперь показывает:
- Зелья в отдельной секции
- Подсказку как использовать
- Все предметы и экипировку

## Структура базы данных

### Новые таблицы

#### `player_progress` (обновлена)
- Убран `chat_id`
- Теперь `UNIQUE(user_id, season_id)`
- Убран `current_enemy_id`

#### `chat_progress` (новая)
- Отслеживает прогресс в каждом чате
- Поля: `current_floor`, `highest_floor_reached`, `is_primary_chat`

#### `combat_state` (новая)
- Хранит текущий бой игрока
- Сохраняется между чатами
- `UNIQUE(user_id, season_id)`

### Изменения в существующих таблицах

#### `cooldowns`
- Убран `chat_id` из UNIQUE constraint
- Теперь `UNIQUE(user_id, action_type)`
- Кулдаун теперь глобальный

#### `behavior_profiles`
- Убран `chat_id` из UNIQUE constraint
- Теперь `UNIQUE(user_id, season_id)`
- Поведение отслеживается глобально

#### `player_progress_old`
- Старая таблица сохранена для безопасности
- Можно удалить после проверки: `DROP TABLE player_progress_old;`

## Тестирование после миграции

### Тест 1: Базовая функциональность
```bash
# В любом чате с ботом
/start
/class
# Выберите класс
атака
# Проверьте что бой работает
```

### Тест 2: Глобальный прогресс
1. Начните игру в Чате А
2. Дойдите до этажа 5
3. Проверьте `/status`
4. Зайдите в Чат Б
5. `/status` должен показать:
   - Глобальный этаж: 5
   - Этаж в чате Б: 1
6. Получите предмет в чате Б
7. Вернитесь в чат А
8. `/inventory` - предмет должен быть

### Тест 3: Боевое состояние
1. Начните бой в Чате А
2. `атака` - нанесите урон
3. Переключитесь в Чат Б  
4. `атака` - должны продолжить бой с тем же врагом

### Тест 4: Восстановление HP
1. Получите урон в бою
2. `/potion` - должна быть ошибка (нет зелий)
3. Победите босса (получите зелье)
4. Снова получите урон
5. `/potion` - HP должно восстановиться

### Тест 5: Множественные чаты
1. Начните в Чате А (будет primary)
2. Победите врага, запомните золото
3. Зайдите в Чат Б
4. Победите врага - должно быть 50% золота

## Откат миграции

Если что-то пошло не так:

### Вариант 1: Восстановление из бэкапа
```bash
# PostgreSQL
psql -U your_user -d nemesis_db < backup_20241007.sql

# Docker
docker exec -i nemesis-postgres psql -U nemesis -d nemesis_db < backup_20241007.sql
```

### Вариант 2: Ручной откат
```sql
-- Подключитесь к БД
psql -U your_user -d nemesis_db

-- Выполните откат
BEGIN;

-- Вернуть старую таблицу
DROP TABLE IF EXISTS player_progress;
ALTER TABLE player_progress_old RENAME TO player_progress;

-- Удалить новые таблицы
DROP TABLE IF EXISTS combat_state;
DROP TABLE IF EXISTS chat_progress;

-- Восстановить старые ограничения
ALTER TABLE cooldowns DROP CONSTRAINT IF EXISTS cooldowns_user_id_action_type_key;
ALTER TABLE cooldowns ADD CONSTRAINT cooldowns_user_id_chat_id_action_type_key 
  UNIQUE(user_id, chat_id, action_type);

ALTER TABLE behavior_profiles DROP CONSTRAINT IF EXISTS behavior_profiles_user_id_season_id_key;
ALTER TABLE behavior_profiles ADD CONSTRAINT behavior_profiles_user_id_chat_id_season_id_key 
  UNIQUE(user_id, chat_id, season_id);

COMMIT;
```

## Проверка состояния миграции

### Проверить структуру таблиц
```sql
-- Проверить player_progress
\d player_progress

-- Должно быть: user_id, season_id, но БЕЗ chat_id

-- Проверить новые таблицы
\d combat_state
\d chat_progress

-- Проверить что старая таблица существует
\d player_progress_old
```

### Проверить данные
```sql
-- Количество игроков
SELECT COUNT(*) FROM player_progress;

-- Проверить chat_progress
SELECT COUNT(*) FROM chat_progress;

-- Проверить что данные перенеслись
SELECT 
    pp.id,
    u.telegram_id,
    u.first_name,
    pp.floor,
    pp.gold
FROM player_progress pp
JOIN users u ON u.id = pp.user_id
LIMIT 10;
```

## FAQ

**Q: Что произойдет с текущими игроками?**  
A: Их прогресс сохранится. Будет взят максимальный этаж из всех чатов.

**Q: Потеряют ли игроки предметы?**  
A: Нет, все предметы сохраняются. Золото суммируется.

**Q: Нужно ли игрокам что-то делать?**  
A: Нет, они просто продолжат играть. Система работает прозрачно.

**Q: Когда можно удалить player_progress_old?**  
A: После 1-2 недель успешной работы и проверки что всё работает корректно.

**Q: Что если миграция упадёт посередине?**  
A: База останется в старом состоянии (PostgreSQL транзакции). Просто запустите миграцию снова после исправления.

## Мониторинг после миграции

### Логи для мониторинга
```bash
# Запустите бота с логами
npm start 2>&1 | tee bot.log

# Следите за ошибками
tail -f bot.log | grep ERROR
```

### Метрики для проверки
- Количество успешных боёв
- Количество использованных зелий
- Среднее время боя
- Количество переходов между чатами во время боя

### Запросы для мониторинга
```sql
-- Активные бои
SELECT COUNT(*) FROM combat_state;

-- Игроки в нескольких чатах
SELECT user_id, COUNT(*) as chat_count
FROM chat_progress
GROUP BY user_id
HAVING COUNT(*) > 1;

-- Средний прогресс
SELECT AVG(floor) as avg_floor FROM player_progress;
```

## Поддержка

При возникновении проблем:
1. Проверьте логи: `bot.log`
2. Проверьте состояние БД (см. выше)
3. Сделайте скриншот ошибки
4. Опишите шаги воспроизведения

## Следующие шаги

После успешной миграции:
1. ✅ Тестирование всех функций (см. выше)
2. ✅ Мониторинг 24 часа
3. ✅ Сбор отзывов игроков
4. ✅ После недели - удалить `player_progress_old`

## Дополнительные файлы

- `GLOBAL_PROGRESS_UPDATE.md` - полная документация изменений
- `src/database/migrations/004_global_progress.sql` - SQL миграция
- `src/game/PotionService.ts` - новый сервис зелий
- `src/game/SeededRandom.ts` - детерминированная генерация
