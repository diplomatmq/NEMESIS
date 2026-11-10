# еБашня — установка на свой сервер

Telegram Mini App «еБашня» (Пепельный Шпиль) и её бот. Здесь всё, что нужно для боевого сервера: сама игра, сервер с ботом, музыка и картинки, конфиги и исходник для следующих сборок. Сборка игры — **v206**.

Сейчас игра работает на тестовом сервере (бот @ebashitestbot). Этот пакет ставится как отдельный боевой сервер со своим ботом.

## Что внутри

```
app/                      → это содержимое /opt/emberspire на сервере
  server.py               сервер игры + Telegram-бот (Python 3, только стандартная библиотека)
  duel_engine.js          движок боя для дуэлей и групп (запускается сервером через Node.js)
  ac_worker.js            античит: пересчитывает присланные бои тем же движком (Node.js)
  cards/                  пустая папка, сервер кладёт туда картинки-приглашения
  public/                 всё, что отдаётся браузеру
    index.html            игра (собранная, v206)
    a/ea-*.js             картинки игры отдельным файлом (кэшируется телефоном на год)
    terms.html            условия и конфиденциальность (/terms)
    title.jpg, title.mp4, title.webm   заставка
    music/*.mp3           музыка
config/
  emberspire.env.example  настройки сервера (токен бота, адрес и т. д.)
  emberspire.service      systemd-служба
  Caddyfile               https перед сервером
  90-bbr.conf             по желанию: BBR, быстрее грузится на мобильном интернете
source/                   нужно только для новых версий игры
  emberspire.html         исходник игры (один файл)
  build/                  сборка index.html из исходника (build.sh, tgshim.js, boot.html, split_assets.py)
  stats/                  страница статистики /stats (stats_page.html) и скрипт, вставляющий её в server.py
```

Симуляции баланса и прототипы художественных паков в пакет не входят.

## Что нужно на сервере

- Linux (проверено на Ubuntu), открытые порты 80 и 443, домен на IP сервера.
- **Python 3.8+**. Внешние библиотеки не нужны. По желанию `python3-pil` (Pillow): с ним бот отправляет красивую картинку-вызов на дуэль, без него — обычную ссылку.
- **Node.js 18+** — обязательно. На нём работают бои в дуэлях и группах, античит и сжатие brotli.
- **Caddy** — https и сертификат автоматически. Можно nginx, но тогда https настраивается вручную.
- Доступ сервера к `api.telegram.org`: бот работает через long polling (`getUpdates`), вебхук не нужен.

## Установка

1. **Бот.** В @BotFather:
   - создать бота и взять токен;
   - `/newapp` — Mini App с адресом игры (`https://ваш-домен/`) и коротким именем (например, `game`);
   - включить платежи звёздами (Telegram Stars) для бота: в игре есть покупки за звёзды.
2. **Файлы.**
   ```
   mkdir -p /opt/emberspire
   cp -r app/* /opt/emberspire/
   curl -o /opt/emberspire/public/tg.js https://telegram.org/js/telegram-web-app.js
   ```
   `tg.js` — копия Telegram Mini App SDK. Игра сначала берёт её со своего сервера (так быстрее и надёжнее в регионах, где telegram.org медленный), а если её нет — с telegram.org.
3. **Настройки.**
   ```
   cp config/emberspire.env.example /opt/emberspire/emberspire.env
   nano /opt/emberspire/emberspire.env      # BOT_TOKEN, WEBAPP_URL, APP_NAME, ADMIN_IDS, CHANNEL, SUPPORT_URL
   chmod 600 /opt/emberspire/emberspire.env
   ```
   `ADMIN_IDS` — Telegram id владельцев, через запятую. Им доступны `/stats`, админ-кнопки в игре и ежедневная сводка античита. Бот должен быть администратором канала из `CHANNEL`, иначе задание «подписаться на канал» не проверится.
4. **Служба.**
   ```
   cp config/emberspire.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now emberspire
   journalctl -u emberspire -f      # должно быть «Emberspire on 127.0.0.1:8080»
   ```
5. **https.** В `config/Caddyfile` заменить `game.example.com` на свой домен, положить в `/etc/caddy/Caddyfile`, затем `systemctl reload caddy`.
6. **По желанию — BBR:** `cp config/90-bbr.conf /etc/sysctl.d/ && sysctl --system`.

При старте бот сам ставит кнопку «Играть» в меню и команды `/terms`, `/paysupport`, `/статистика` для админов.

## Проверка

- `curl https://ваш-домен/api/health` отвечает.
- `grep -o "APP_VER='[0-9]*'" /opt/emberspire/public/index.html` → `APP_VER='206'`.
- В Telegram: открыть бота → «Играть». Игра грузится, прогресс сохраняется. Закрыть, открыть с другого устройства — прогресс тот же.
- Админ пишет боту `/статистика` или открывает `https://ваш-домен/stats` из игры.

## Данные

Вся база — один файл sqlite: `/opt/emberspire/emberspire.db`. Там сохранения игроков, топ, дуэли, группы, рейды, звёзды и статистика.

- **Бэкап:** раз в сутки копировать этот файл, например `sqlite3 emberspire.db ".backup /backup/ember-$(date +%F).db"`.
- **Перенести игроков с тестового сервера** (если нужно): остановить там службу и скопировать `/opt/emberspire/emberspire.db` на новый сервер до первого запуска. Сохранения привязаны к Telegram id, поэтому с новым ботом игроки увидят свой прогресс.

## Выпуск новой версии игры

Игра собирается из одного файла `source/emberspire.html`:

```
cd source
sh build/build.sh emberspire.html out/index.html
python3 build/split_assets.py out/index.html        # картинки → out/a/ea-<hash>.js
cd out && tar czf ../ember.tar.gz index.html a
# на сервере:
tar xzf ember.tar.gz -C /opt/emberspire/public
```

- Перезапускать службу не нужно: сервер подхватывает новый `index.html` сам.
- Старые `a/ea-*.js` не удалять сразу: у игроков с открытым приложением они ещё в кэше.
- После правки `source/stats/stats_page.html` запустить `python3 source/stats/embed_stats.py /opt/emberspire/server.py`, затем `systemctl restart emberspire`.
- После любой правки `server.py`: `systemctl restart emberspire`.

## Важно

- Голый `emberspire.html` на сервер класть нельзя, только собранный через `build.sh`. Сборка добавляет Telegram SDK, viewport и место под конфиг бота. Без неё не работают вход через Telegram, облачные сохранения и платежи.
- `duel_engine.js` и `ac_worker.js` читают правила боя из `public/index.html`, из блока `<script id="logic">`. `split_assets.py` этот блок не трогает, ничего настраивать не нужно.
- Играть можно только с одного устройства одновременно: второе устройство «забирает» аккаунт.
