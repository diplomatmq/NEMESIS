-- Season 1 catalog for public statistics.
-- The season name is stored as data only and is not added to combat messages.

ALTER TABLE enemies
  ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_enemies_season_floor
  ON enemies (season_id, floor_range_min, floor_range_max);

-- The first season is the initial season created by 002_seed_data.sql.
-- Resolve it by season number so this remains safe if its generated id changes.
WITH season_one AS (
  SELECT id FROM seasons WHERE season_number = 1 LIMIT 1
)
UPDATE enemies
SET season_id = (SELECT id FROM season_one)
WHERE season_id IS NULL;

-- Replace the small bootstrap boss list with the complete season catalog.
DELETE FROM enemies
WHERE is_boss = true
  AND season_id = (SELECT id FROM seasons WHERE season_number = 1 LIMIT 1);

-- Fifty named bosses, one on every tenth floor through floor 500.
WITH season_one AS (
  SELECT id FROM seasons WHERE season_number = 1 LIMIT 1
),
bosses AS (
  SELECT *
  FROM unnest(
    ARRAY[
      'Страж Врат','Костяной Дракон','Владыка Теней','Повелитель Пламени','Ледяной Колосс',
      'Королева Пауков','Гниющий Друид','Железный Голем','Громовой Виверн','Архимаг Предела',
      'Песчаный Пожиратель','Рыцарь Пепла','Морская Ведьма','Минотавр Лабиринта','Хранитель Часов',
      'Алый Палач','Некромант-Король','Призрачный Адмирал','Химера Бездны','Вулканический Титан',
      'Сфинкс Забвения','Чумной Епископ','Лунный Охотник','Башенный Разрушитель','Дракон Миражей',
      'Морозный Лич','Король Гоблинов','Змей Девяти Клыков','Стальной Самурай','Колдунья Багрового Дождя',
      'Пожиратель Звёзд','Титан Корней','Владыка Зеркал','Граф Ноктюрн','Оракул Пустоты',
      'Демон-Кузнец','Повелитель Миазмов','Феникс Пепла','Кристальный Страж','Ведьмак Бездны',
      'Левиафан Небес','Ткач Судеб','Император Мёртвых','Сердце Бури','Архидемон Врат',
      'Астральный Колосс','Повелитель Хаоса','Последний Рыцарь','Апокалипсис','Вершинный Судья'
    ],
    ARRAY[
      'Первый хранитель','Нежить драконьего рода','Повелитель тьмы','Огненный титан','Вечная мерзлота',
      'Мать ядовитого улья','Голос проклятого леса','Кузня воли','Крыло бури','Последний учёный',
      'Владыка дюн','Несломленный клятвопреступник','Певица глубин','Хозяин тысячи стен','Сломанный хронос',
      'Клинок кровавой луны','Повелитель костей','Флот мёртвых вод','Три голоса хаоса','Сердце магмы',
      'Загадка без ответа','Проповедник распада','Серебряный след','Осадная машина','Сон пустыни',
      'Вечный холод','Собиратель корон','Яд глубин','Последняя стойка','Небо из крови',
      'Бездна над башней','Сердце чащи','Тысяча отражений','Бессмертная ночь','Глаз за гранью',
      'Молот преисподней','Дыхание гнили','Последнее возрождение','Осколок вечности','Охотник на героев',
      'Затмение крыльев','Нить последнего часа','Трон костей','Живой ураган','Печать последнего круга',
      'Тело созвездия','Случайность плоти','Клятва вершины','Конец пути','Судья вершины'
    ]
  ) WITH ORDINALITY AS b(name, title, boss_number)
)
INSERT INTO enemies
  (name, description, level, hp, attack, defense, is_boss, is_elite,
   floor_range_min, floor_range_max, abilities, ai_personality, season_id)
SELECT
  b.name,
  b.title,
  b.boss_number,
  180 + b.boss_number * 90,
  12 + b.boss_number * 5,
  8 + b.boss_number * 3,
  true,
  false,
  b.boss_number * 10,
  b.boss_number * 10,
  jsonb_build_array(
    jsonb_build_object(
      'name', 'Уникальная способность ' || b.boss_number,
      'description', 'Индивидуальная способность босса ' || b.name,
      'damage_multiplier', 1.15 + ((b.boss_number - 1) % 6) * 0.1,
      'cooldown', 2 + ((b.boss_number - 1) % 4)
    )
  ),
  jsonb_build_object('type', CASE (b.boss_number - 1) % 5
    WHEN 0 THEN 'aggressive' WHEN 1 THEN 'defensive'
    WHEN 2 THEN 'adaptive' WHEN 3 THEN 'chaotic' ELSE 'tactical' END),
  s.id
FROM bosses b
CROSS JOIN season_one s
WHERE NOT EXISTS (
  SELECT 1 FROM enemies e
  WHERE e.season_id = s.id AND e.is_boss = true
    AND e.floor_range_min = b.boss_number * 10
);

-- Three regular mobs for each of the fifty ten-floor zones. Zone 0 covers
-- floors 1-9; zones 1-49 cover 11-19 through 491-499.
WITH season_one AS (
  SELECT id FROM seasons WHERE season_number = 1 LIMIT 1
),
zone_mobs AS (
  SELECT mob_one, mob_two, mob_three, row_number() OVER () - 1 AS zone_number
  FROM unnest(
    ARRAY['Пещерный гоблин','Каменный голем','Орк-воин','Теневой волк','Огненный элементаль',
      'Ледяной элементаль','Корневой зверь','Железный страж','Громовой ящер','Ученик бездны',
      'Песчаный червь','Рыцарь пепла','Морская сирена','Лабиринтный минотавр','Сломанный голем',
      'Алый дуэлянт','Костяной маг','Призрачный матрос','Химерный зверь','Магмовый червь',
      'Сфинкс-пилигрим','Чумной монах','Серебряный охотник','Осадный орк','Миражный убийца',
      'Морозный лич','Королевский гоблин','Девятиглавый змей','Стальной самурай','Багровая ведьма',
      'Звёздный паразит','Титан корней','Зеркальный двойник','Ночной граф','Оракул-слепец',
      'Адский кузнец','Миазменный дух','Пепельный феникс','Кристальный рыцарь','Охотник на героев',
      'Небесный дракон','Ткач-паразит','Имперский некромант','Живой ураган','Младший архидемон',
      'Астральный голем','Хаотический зверь','Последний страж','Мёртвый апостол','Апокалиптический зверь'],
    ARRAY['Слабый скелет','Пещерный паук','Гоблин-шаман','Ночной убийца','Пепельный бес',
      'Морозный волк','Гнилой друид','Механический паук','Штормовой сокол','Живая книга',
      'Разбойник дюн','Огненный скелет','Глубинный краб','Каменный бык','Часовой механизм',
      'Кровавый культист','Могильный рыцарь','Скелет-канонир','Безликий охотник','Вулканический бес',
      'Песчаный пророк','Гниющий носитель','Лунная гарпия','Каменный разрушитель','Пустынный фантом',
      'Ледяной рыцарь','Золотой вор','Ядовитая гидра','Дух клинка','Кровавый ворон',
      'Астральная медуза','Древесный энт','Отражённый рыцарь','Алый вампир','Глаз пустоты',
      'Железный демон','Чумной зверь','Воскресший воин','Осколочный голем','Проклятый ведьмак',
      'Крылатый лев','Нитяная ведьма','Костяной легионер','Грозовой элементаль','Бездонный пёс',
      'Звёздный рыцарь','Случайный фантом','Вершинный рыцарь','Пожиратель душ','Апокалиптический зверь'],
    ARRAY['Крысиный разведчик','Разбойник тоннелей','Боевой кабан','Призрачная летучая мышь','Лавовый жук',
      'Снежный призрак','Лесной охотник','Ржавый голем','Искровой бес','Магический паразит',
      'Миражный шакал','Пепельная гарпия','Утопленник','Блуждающий фантом','Хрономант',
      'Лунный волк','Мёртвый знаменосец','Туманная сирена','Щупальце бездны','Обсидиановый страж',
      'Забытый страж','Крыса-мутант','Зверь затмения','Таранный зверь','Зеркальная змея',
      'Кристальный волк','Шаман племени','Кобра алтаря','Ронин-тень','Проклятый жрец',
      'Пожиратель света','Сердце чащи','Мимик зеркал','Замковый упырь','Прорицатель теней',
      'Огненный рабочий','Туманная личинка','Жар-птица','Лучистый паук','Трофейный зверь',
      'Грозовой змей','Кукла судьбы','Мёртвый знаменосец','Молниевый дух','Пламенный инкуб',
      'Световой охотник','Мутант пустоты','Хранитель клятвы','Апокалиптический зверь','Пожиратель душ']
  ) AS z(mob_one, mob_two, mob_three)
)
INSERT INTO enemies
  (name, description, level, hp, attack, defense, is_boss, is_elite,
   floor_range_min, floor_range_max, abilities, season_id)
SELECT
  mob.name || ' — зона ' || zone_number,
  'Обычный противник первой эпохи башни',
  zone_number + 1,
  50 + (zone_number + 1) * 20,
  8 + (zone_number + 1) * 3,
  3 + (zone_number + 1) * 2,
  false,
  false,
  CASE WHEN zone_number = 0 THEN 1 ELSE zone_number * 10 + 1 END,
  CASE WHEN zone_number = 0 THEN 9 ELSE zone_number * 10 + 9 END,
  '[]'::jsonb,
  s.id
FROM zone_mobs
CROSS JOIN season_one s
CROSS JOIN LATERAL unnest(ARRAY[zone_mobs.mob_one, zone_mobs.mob_two, zone_mobs.mob_three]) AS mob(name)
WHERE NOT EXISTS (
  SELECT 1 FROM enemies e
  WHERE e.season_id = s.id AND e.is_boss = false
    AND e.floor_range_min = CASE WHEN zone_number = 0 THEN 1 ELSE zone_number * 10 + 1 END
    AND e.name = mob.name || ' — зона ' || zone_number
);
