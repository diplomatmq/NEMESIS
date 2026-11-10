#!/usr/bin/env python3
"""Emberspire server: serves the game, keeps the leaderboard, chat raids, friend invites and rest reminders,
and runs the Telegram bot.

Python 3.8+ standard library. Pillow (apt install python3-pil) is optional: it turns the challenge card into
the JPEG Telegram needs for the "send to a chat" card; without it the game shares a plain link instead.

Settings come from environment variables (see emberspire.env.example):
  BOT_TOKEN   token from @BotFather (required)
  WEBAPP_URL  public https address of the game, e.g. https://emberspire.example.com/
  APP_NAME    short name of the Mini App made with /newapp in @BotFather, default "game"
  PORT        local port, default 8080 (Caddy forwards https traffic here)
  DB_PATH     sqlite file, default ./emberspire.db
"""
import html as _html
import random
import base64, hashlib, hmac, io, json, os, sqlite3, threading, time, urllib.parse, urllib.request, urllib.error, mimetypes, logging

from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
WEBAPP_URL = os.environ.get("WEBAPP_URL", "").strip()
# where players write about the game and payments (a channel post); shown on /terms, /paysupport and the terms page
SUPPORT_URL = os.environ.get("SUPPORT_URL", "").strip()
def terms_url():
    return (WEBAPP_URL.rstrip("/") + "/terms") if WEBAPP_URL else ""
if WEBAPP_URL and not WEBAPP_URL.endswith("/"):
    WEBAPP_URL += "/"
APP_NAME = os.environ.get("APP_NAME", "game").strip() or "game"
PORT = int(os.environ.get("PORT", "8080"))
HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(HERE, "emberspire.db"))
PUBLIC = os.path.join(HERE, "public")
CARDS = os.path.join(HERE, "cards")
os.makedirs(CARDS, exist_ok=True)

INIT_MAX_AGE = 24 * 3600      # Telegram sign-in data older than a day is refused
ROOM_SECONDS = 12             # a fair player needs at least the 15 s cooldown plus the fight per room; 12 s leaves slack
ROOM_SLACK = 3                # rooms allowed on top of the time budget (network hiccups, retries)
TOP_N = 10

# raid: one boss per group chat per week, everyone hits whenever they like (must match the game)
RAID_NAME = "Король Пепла"
# chat bosses: name, accusative for "призывает …", words /boss understands
RAID_BOSSES = {"raidboss": ("Король Пепла", "Короля Пепла", ("король", "пепел", "king", "ash")),
               "deruv": ("Павол Дерув", "Павола Дерува", ("павол", "дерув", "pavol", "deruv", "durov", "дуров")),
               "ohevich": ("Андре Охевич", "Андре Охевича", ("андре", "охевич", "andre", "ohevich", "ohuenko")),
               "idea": ("Идейный @ideaAnimator", "Идейного @ideaAnimator", ("идейн", "idea", "аниматор", "animator", "ideaanimator"))}
RAID_NEW_W = 2967             # Идейный joins the weekly rotation from Monday 9.11.2026, so this week's boss doesn't change (must match the game)
def raid_boss_of(ci, week):
    """An event keeps the boss its admin called; a plain chat raid changes boss every week (and differs between chats)."""
    if week == -1:
        r = db.execute("SELECT boss FROM raid_events WHERE ci=?", (ci,)).fetchone()
        if r and r[0] in RAID_BOSSES:
            return r[0]
    keys = list(RAID_BOSSES)
    if week < RAID_NEW_W:
        keys = keys[:3]
    return keys[(int(hashlib.md5(str(ci).encode()).hexdigest()[:6], 16) + max(0, week)) % len(keys)]
RAID_TRIES = 3                # hits per player per day (UTC), as in the game
RAID_MIN_GAP = 30             # seconds between two hits of one player: a raid fight lasts 40 s
RAID_SHARE = 8                # each new raider adds this many typical hits to the boss's health

# friends: what the inviter gets when a friend reaches these rooms, and the newcomer's gift (must match the game)
REF_STEPS = [(10, 5, 1), (30, 5, 2), (60, 10, 3)]     # (room, rest skips, cores) for the inviter; stars are never given, only bought
WELCOME = {"skips": 5, "cores": 1}                     # the newcomer's gift: rest skips land on the server balance at once

ADMIN_IDS = {int(x) for x in os.environ.get("ADMIN_IDS", "678418106").replace(" ", "").split(",") if x}
REMIND_EVERY = float(os.environ.get("REMIND_GAP_H", "8")) * 3600      # at most one rest reminder per player in this many seconds
REMIND_AWAY = float(os.environ.get("REMIND_AWAY_MIN", "30")) * 60     # ...and only after the player has been away this long

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("emberspire")

# ---------------------------------------------------------------- storage
db_lock = threading.Lock()
db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.execute("""CREATE TABLE IF NOT EXISTS players(
  id INTEGER PRIMARY KEY, name TEXT, username TEXT, cls TEXT, room INTEGER DEFAULT 0, level INTEGER DEFAULT 1,
  kills INTEGER DEFAULT 0, bosses INTEGER DEFAULT 0, wins INTEGER DEFAULT 0,
  first_seen REAL, updated REAL, reached REAL, flagged INTEGER DEFAULT 0)""")
# columns added after the first release: added in place, existing players keep their records
_cols = {r[1] for r in db.execute("PRAGMA table_info(players)")}
for col, decl in [("ref_by", "INTEGER"), ("welcomed", "INTEGER DEFAULT 0"), ("ref_paid", "INTEGER DEFAULT 0"),
                  ("notify", "INTEGER DEFAULT 0"), ("rest_at", "REAL DEFAULT 0"), ("reminded", "REAL DEFAULT 0"),
                  ("seen", "REAL DEFAULT 0"), ("notify_off", "INTEGER DEFAULT 0"), ("can_pm", "INTEGER DEFAULT 0"),
                  ("wipe_at", "REAL DEFAULT 0")]:
    if col not in _cols:
        db.execute(f"ALTER TABLE players ADD COLUMN {col} {decl}")
db.execute("CREATE INDEX IF NOT EXISTS by_room ON players(flagged, room DESC, reached ASC)")
db.execute("CREATE INDEX IF NOT EXISTS by_ref ON players(ref_by)")
db.execute("CREATE INDEX IF NOT EXISTS by_rest ON players(rest_at)")
# ---- balance statistics (v193): who played on which day, and every fight on a floor the hero had not cleared yet
AC_TZ_S = float(os.environ.get("AC_TZ", "3")) * 3600
db.execute("CREATE TABLE IF NOT EXISTS act(day INTEGER, uid INTEGER, PRIMARY KEY(day, uid))")
db.execute("""CREATE TABLE IF NOT EXISTS fight_log(uid INTEGER, ts REAL, room INTEGER, kind TEXT, win INTEGER, tries INTEGER,
  dur INTEGER, cls TEXT, level INTEGER, hp INTEGER, atk INTEGER, df INTEGER, q INTEGER, auto INTEGER)""")
db.execute("CREATE INDEX IF NOT EXISTS fl_ts ON fight_log(ts)")
db.execute("CREATE TABLE IF NOT EXISTS ref_hits(inviter INTEGER, visitor INTEGER, day INTEGER, PRIMARY KEY(inviter, visitor, day))")
db.execute("""CREATE TABLE IF NOT EXISTS raids(ci TEXT, week INTEGER, max INTEGER, hp INTEGER, killed REAL,
  PRIMARY KEY(ci, week))""")
db.execute("""CREATE TABLE IF NOT EXISTS raid_hits(ci TEXT, week INTEGER, uid INTEGER, dmg INTEGER DEFAULT 0,
  claimed INTEGER DEFAULT 0, PRIMARY KEY(ci, week, uid))""")
db.execute("""CREATE TABLE IF NOT EXISTS saves(uid INTEGER PRIMARY KEY, data TEXT, score REAL, ts REAL)""")
# chat events made by a group admin with /boss: the boss lives in raids/raid_hits under ci 'g<chat id>' and week -1
db.execute("""CREATE TABLE IF NOT EXISTS raid_events(ci TEXT PRIMARY KEY, chat_id INTEGER, by_uid INTEGER, ends REAL,
  lvl INTEGER DEFAULT 1, closed INTEGER DEFAULT 0)""")
if "title" not in {r[1] for r in db.execute("PRAGMA table_info(raid_events)")}:
    db.execute("ALTER TABLE raid_events ADD COLUMN title TEXT")
if "boss" not in {r[1] for r in db.execute("PRAGMA table_info(raid_events)")}:
    db.execute("ALTER TABLE raid_events ADD COLUMN boss TEXT")
db.execute("""CREATE TABLE IF NOT EXISTS raid_tries_c(uid INTEGER, ci TEXT, day INTEGER, n INTEGER DEFAULT 0, last REAL DEFAULT 0,
  PRIMARY KEY(uid, ci, day))""")
db.execute("""CREATE TABLE IF NOT EXISTS raid_stats(uid INTEGER, ci TEXT, dmg INTEGER DEFAULT 0, best INTEGER DEFAULT 0, hits INTEGER DEFAULT 0,
  PRIMARY KEY(uid, ci))""")
db.execute("CREATE TABLE IF NOT EXISTS raid_chats(ci TEXT PRIMARY KEY)")
db.execute("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)")
_rcols = {r[1] for r in db.execute("PRAGMA table_info(raids)")}
if "lvl" not in _rcols:
    db.execute("ALTER TABLE raids ADD COLUMN lvl INTEGER DEFAULT 1")
db.execute("""CREATE TABLE IF NOT EXISTS raid_tries(uid INTEGER, day INTEGER, n INTEGER DEFAULT 0, last REAL DEFAULT 0,
  PRIMARY KEY(uid, day))""")
db.commit()

# ---------------------------------------------------------------- telegram sign-in check
def check_init_data(init_data):
    """Validate Telegram Mini App initData. Returns (user, fields) or (None, None)."""
    if not init_data or not BOT_TOKEN:
        return None, None
    data = dict(urllib.parse.parse_qsl(init_data, keep_blank_values=True))
    got = data.pop("hash", None)
    if not got:
        return None, None
    check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    want = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(want, got):
        return None, None
    try:
        if time.time() - int(data.get("auth_date", "0")) > INIT_MAX_AGE:
            return None, None
        user = json.loads(data.get("user", "null"))
    except (ValueError, TypeError):
        return None, None
    if not (isinstance(user, dict) and "id" in user):
        return None, None
    return user, data

def display_name(u):
    name = (u.get("first_name", "") + " " + u.get("last_name", "")).strip()
    return (name or u.get("username") or "Игрок")[:40]

def as_int(v, lo=0, hi=10**9):
    try:
        return max(lo, min(hi, int(v)))
    except (ValueError, TypeError):
        return lo

def day_id(now=None):
    return int((now or time.time()) // 86400)

def week_id(now=None):
    """Weeks start on Monday 00:00 UTC, the same count the game uses."""
    return int(((now or time.time()) / 86400 + 3) // 7)

def week_end_ms(week):
    return ((week + 1) * 7 - 3) * 86400 * 1000

# ---------------------------------------------------------------- players and leaderboard
def ensure_player(user):
    """First contact registers the player, so the time budget for rooms starts counting from then.
    Returns True when the player is new."""
    now = time.time()
    with db_lock:
        cur = db.execute("INSERT OR IGNORE INTO players(id, name, username, room, first_seen, updated, seen) VALUES(?,?,?,0,?,?,?)",
                         (user["id"], display_name(user), user.get("username"), now, now, now))
        db.execute("UPDATE players SET seen=? WHERE id=?", (now, user["id"]))
        db.execute("INSERT OR IGNORE INTO act(day, uid) VALUES(?,?)", (int((now + AC_TZ_S) // 86400), user["id"]))
        if user.get("allows_write_to_pm"):
            # reminders are on by default for everyone the bot may write to, unless they switched them off
            db.execute("UPDATE players SET can_pm=1, notify=CASE WHEN notify_off=1 THEN notify ELSE 1 END WHERE id=?", (user["id"],))
        db.commit()
        return cur.rowcount == 1

def _ref_ping(inviter, friend, need, sk, co):
    """«Твой друг прошёл 10 этажей»: a bot message with a button straight to the reward."""
    with db_lock:
        pm = db.execute("SELECT can_pm FROM players WHERE id=?", (inviter,)).fetchone()
    log.info("ref step: %s passed %s for inviter %s", friend, need, inviter)
    if not (pm and pm[0]):
        return
    txt = (f"🎉 Твой друг {friend} прошёл {need} этажей!\n"
           f"Тебе награда: {sk} пропусков отдыха и {co} {'ядро' if co == 1 else 'ядра'}.\n"
           f"Забери её: Мир → Я → Друзья.")
    def go():
        try:
            tg("sendMessage", chat_id=inviter, text=txt,
               reply_markup={"inline_keyboard": [[{"text": "Забрать награду", "url": app_link("friends")}]]})
        except Exception as e:
            log.info("ref pm to %s: %s", inviter, e)
    threading.Thread(target=go, daemon=True).start()

def submit_score(user, body):
    now = time.time()
    room, level = as_int(body.get("room")), as_int(body.get("level"), 1, 10000)
    wins, kills, bosses = as_int(body.get("wins")), as_int(body.get("kills")), as_int(body.get("bosses"))
    cls = str(body.get("cls", ""))[:20]
    with db_lock:
        row = db.execute("SELECT room, first_seen FROM players WHERE id=?", (user["id"],)).fetchone()
        prev_room, first_seen = row if row else (0, now)
        reason = None
        # every room needs a won fight, a boss every tenth room, and real time between rooms
        sv = _save_of(user["id"])
        if room > wins + 1:
            reason = "more rooms than wins"
        elif room > prev_room and user["id"] not in ADMIN_IDS and (not sv or room > as_int(sv.get("maxCleared"), 0, 10**7) + 3):
            reason = "save behind"
        elif room >= 50 and bosses < room // 50:
            reason = "skipped bosses"
        elif room > prev_room and room > ROOM_SLACK + (now - (first_seen or now)) / ROOM_SECONDS:
            reason = "too fast"
        if reason:
            log.warning("score refused for %s: room %s (prev %s): %s", user["id"], room, prev_room, reason)
            return 422, {"ok": False, "reason": reason}
        best = max(room, prev_room)
        reached = now if room > prev_room else None
        db.execute("""UPDATE players SET name=?, username=?, cls=?, room=?, level=?, kills=?, bosses=?, wins=?, updated=?,
                      reached=COALESCE(?, reached) WHERE id=?""",
                   (display_name(user), user.get("username"), cls, best, level, kills, bosses, wins, now, reached, user["id"]))
        db.commit()
        # an invited friend just passed a reward floor: tell the one who invited them
        rb = db.execute("SELECT ref_by FROM players WHERE id=?", (user["id"],)).fetchone()
        steps = [st for st in REF_STEPS if prev_room < st[0] <= best] if rb and rb[0] else []
    for need, sk, co in steps:
        _ref_ping(rb[0], display_name(user), need, sk, co)
    return 200, {"ok": True, "room": best}

def _cls_aliases(key):
    """players.cls holds what the game sent: the class key or its Russian name (older versions). All spellings of one class."""
    a = {key}
    if key in CLS_RU:
        a.add(CLS_RU[key])
    if key == "duelist":
        a.add("Гамблер")
    return sorted(a)

def _cls_key(c):
    c = (c or "").strip()
    if c in CLS_RU:
        return c
    for k, v in CLS_RU.items():
        if v.lower() == c.lower():
            return k
    return "duelist" if c.lower() == "гамблер" else ""

def leaderboard(user, cls=""):
    """The tower's top, or (v195) the top of one class; with the list of classes that have players on the board."""
    key = _cls_key(cls)
    with db_lock:
        if key:
            al = _cls_aliases(key)
            ph = ",".join("?" * len(al))
            top = db.execute(f"""SELECT id, name, cls, room, level FROM players WHERE flagged=0 AND room>0 AND cls IN ({ph})
                                 ORDER BY room DESC, reached ASC LIMIT ?""", (*al, TOP_N)).fetchall()
        else:
            top = db.execute("""SELECT id, name, cls, room, level FROM players WHERE flagged=0 AND room>0
                                ORDER BY room DESC, reached ASC LIMIT ?""", (TOP_N,)).fetchall()
        me = db.execute("SELECT room, reached, cls FROM players WHERE id=?", (user["id"],)).fetchone()
        my_key = _cls_key(me[2]) if me else ""
        rank = None
        if me and me[0] > 0 and (not key or key == my_key):
            if key:
                rank = 1 + db.execute(f"""SELECT COUNT(*) FROM players WHERE flagged=0 AND cls IN ({ph}) AND (room>? OR (room=? AND reached<?))""",
                                      (*al, me[0], me[0], me[1])).fetchone()[0]
            else:
                rank = 1 + db.execute("""SELECT COUNT(*) FROM players WHERE flagged=0 AND (room>? OR (room=? AND reached<?))""",
                                      (me[0], me[0], me[1])).fetchone()[0]
        rows = []
        for i, (pid, n, c, r, lv) in enumerate(top):
            sv = _save_of(pid)          # what the hero wears, for the portraits on the podium
            rows.append({"rank": i + 1, "name": n, "cls": CLS_RU.get(c, c), "room": r, "level": lv or 0, "me": pid == user["id"], "tag": _tag(pid),
                         "look": _look(sv) if sv else None})
        counts = {}
        for c, n in db.execute("SELECT cls, COUNT(*) FROM players WHERE flagged=0 AND room>0 GROUP BY cls").fetchall():
            k = _cls_key(c)
            if k:
                counts[k] = counts.get(k, 0) + n
        db.commit()
    classes = [{"key": k, "ru": CLS_RU.get(k, k), "n": n} for k, n in sorted(counts.items(), key=lambda x: -x[1])]
    return 200, {"top": rows, "me": {"rank": rank, "room": me[0]} if rank else None, "cls": key, "my_cls": my_key, "classes": classes}

# ---------------------------------------------------------------- friends
def hello(user, fields, is_new, body):
    """A newcomer who opened an invite link (start param ref_<id>) gets a gift once, and the inviter is remembered."""
    start = str(fields.get("start_param") or body.get("start") or "")
    admin = user["id"] in ADMIN_IDS
    with db_lock:
        _qbase(user["id"]); _qbase_f(user["id"], "ekills"); _qbase_f(user["id"], "bkills")
        db.commit()
    if not (start.startswith("ref_") or start.startswith("rr_") or start.startswith("duel_")):
        return 200, {"ok": True, "admin": admin}
    with db_lock:
        if start.startswith("duel_"):
            # a duel link thrown into a chat invites too: the one who threw it is the inviter
            d = db.execute("SELECT from_uid FROM duels WHERE id=?", (start[5:21],)).fetchone()
            inviter = d[0] if d else 0
        else:
            inviter = as_int(start.split("_", 1)[1])
        # the daily «someone came by your link»: any player but the link's owner, once a day each. Only an invite link counts:
        # opening a duel challenge is the duel itself (it counts for «Сыграть дуэль»), not an invitation
        if inviter and inviter != user["id"] and not start.startswith("duel_"):
            db.execute("INSERT OR IGNORE INTO ref_hits(inviter, visitor, day) VALUES(?,?,?)", (inviter, user["id"], q_day()))
            db.commit()
        # «new» is not only the very first request: the game loads the cloud save before it says hello, and a friend may
        # have pressed /start in the bot first. A newcomer is anyone without an inviter yet, seen for the first time within
        # two days and still below floor 10 — an old player can't be claimed by someone's link.
        me = db.execute("SELECT ref_by, welcomed, room, first_seen FROM players WHERE id=?", (user["id"],)).fetchone()
        fresh = is_new or (me and me[0] is None and not me[1] and (me[2] or 0) < 10 and time.time() - (me[3] or 0) < 2 * 86400)
        if not fresh:
            return 200, {"ok": True, "admin": admin}
        ok = inviter and inviter != user["id"] and db.execute("SELECT 1 FROM players WHERE id=?", (inviter,)).fetchone()
        if not ok:
            return 200, {"ok": True}
        cur = db.execute("UPDATE players SET ref_by=?, welcomed=1 WHERE id=? AND ref_by IS NULL", (inviter, user["id"]))
        if cur.rowcount == 1:
            db.execute("UPDATE players SET skips=skips+? WHERE id=?", (WELCOME["skips"], user["id"]))
            db.execute("INSERT INTO star_ledger(uid, delta, what, n, ts) VALUES(?,?,?,?,?)", (user["id"], 0, "ref-welcome-skips", WELCOME["skips"], time.time()))
        db.commit()
    if cur.rowcount != 1:
        return 200, {"ok": True, "admin": admin}
    log.info("player %s joined by invite from %s", user["id"], inviter)
    return 200, {"ok": True, "welcome": WELCOME}

def ref_state(uid):
    friends = db.execute("SELECT name, room, ref_paid FROM players WHERE ref_by=? ORDER BY room DESC LIMIT 100", (uid,)).fetchall()
    skips = cores = 0
    for _, room, paid in friends:
        for i, (need, k_, c) in enumerate(REF_STEPS):
            if i >= (paid or 0) and room >= need:
                skips += k_
                cores += c
    return friends, skips, cores

def ref_info(user):
    with db_lock:
        friends, skips, cores = ref_state(user["id"])
    return 200, {"friends": [{"name": n, "room": r} for n, r, _ in friends], "claimable": {"skips": skips, "cores": cores}}

def ref_claim(user):
    with db_lock:
        friends, skips, cores = ref_state(user["id"])
        for room_need_idx in range(len(REF_STEPS), 0, -1):
            need = REF_STEPS[room_need_idx - 1][0]
            db.execute("UPDATE players SET ref_paid=? WHERE ref_by=? AND room>=? AND ref_paid<?",
                       (room_need_idx, user["id"], need, room_need_idx))
        db.commit()
        if skips:
            db.execute("UPDATE players SET skips=skips+? WHERE id=?", (skips, user["id"]))
            db.execute("INSERT INTO star_ledger(uid, delta, what, n, ts) VALUES(?,?,?,?,?)", (user["id"], 0, "ref-skips", skips, time.time()))
        db.commit()
    return 200, {"skips": skips, "cores": cores}

# ---------------------------------------------------------------- chat raid
# Two kinds: the weekly boss of a group chat (key = chat_instance) and an admin's event (key 'g<chat id>', week -1, /boss).
# try_dmg(room) is what an average hero of that floor deals in one 40-second try (measured in the game's balance sim).
# The boss starts at 3 tries of the host's floor and each new fighter adds 2 tries of their own floor, so a chat of N players
# needs about two thirds of one day's tries. The fight in the game starts with the boss's real HP and ends when it dies.
def _curve(n, a, b, piv=70):
    if n <= piv:
        return 1 + a * n + b * n * n
    v = 1 + a * piv + b * piv * piv
    k = (a + 2 * b * piv) * piv / v
    return v * (n / piv) ** k

def try_dmg(room):
    r = max(1, room)
    return int(_curve(r - 1, 0.24, 0.006) * (500 + 4 * r))

def raid_key(fields, given):
    """An admin's event ('g<chat id>') when it exists; otherwise the group the game was opened from (signed by Telegram)."""
    given = str(given or "")
    if given.startswith("g"):
        ev = db.execute("SELECT ends, closed FROM raid_events WHERE ci=?", (given,)).fetchone()
        # only a running event: once it is over the bot has posted the results and the chat's own raid is back
        if ev and not ev[1] and ev[0] > time.time():
            gi = fields.get("chat_instance") if fields.get("chat_type") in ("group", "supergroup") else None
            if gi:
                db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", ("ev:" + gi, given))
            return given, -1
    inst = fields.get("chat_instance") if fields.get("chat_type") in ("group", "supergroup") else None
    if inst:
        # a group that has an admin's event: opened from that group, the game goes straight to its event
        m = db.execute("SELECT v FROM kv WHERE k=?", ("ev:" + inst,)).fetchone()
        if m:
            ev = db.execute("SELECT ends, closed FROM raid_events WHERE ci=?", (m[0],)).fetchone()
            if ev and not ev[1] and ev[0] > time.time():
                return m[0], -1
        # a group without an admin's /boss has no boss at all: only chat admins call one
        return None, "noboss"
    return None, None

def chat_label(ci, uid=None):
    """Telegram does not tell a Mini App the group's name; events know their chat, plain raids get a stable number."""
    ev = db.execute("SELECT title FROM raid_events WHERE ci=?", (ci,)).fetchone()
    if ev and ev[0]:
        return ev[0]
    n = db.execute("SELECT rowid FROM raid_chats WHERE ci=?", (ci,)).fetchone()
    if not n:
        db.execute("INSERT OR IGNORE INTO raid_chats(ci) VALUES(?)", (ci,))
        n = db.execute("SELECT rowid FROM raid_chats WHERE ci=?", (ci,)).fetchone()
    return f"Чат №{n[0]}"

def raid_view(ci, week, uid):
    """The Ash King is immortal: the view is the damage race of this chat."""
    ev = db.execute("SELECT ends, closed, lvl FROM raid_events WHERE ci=?", (ci,)).fetchone() if week == -1 else None
    top = db.execute("""SELECT h.uid, p.name, h.dmg FROM raid_hits h LEFT JOIN players p ON p.id=h.uid
                        WHERE h.ci=? AND h.week=? AND h.dmg>0 ORDER BY h.dmg DESC LIMIT 10""", (ci, week)).fetchall()
    me = db.execute("SELECT dmg FROM raid_hits WHERE ci=? AND week=? AND uid=?", (ci, week, uid)).fetchone()
    my = me[0] if me else 0
    rank = None
    if my > 0:
        rank = 1 + db.execute("SELECT COUNT(*) FROM raid_hits WHERE ci=? AND week=? AND dmg>?", (ci, week, my)).fetchone()[0]
    tot = db.execute("SELECT COALESCE(SUM(dmg),0) FROM raid_hits WHERE ci=? AND week=?", (ci, week)).fetchone()[0]
    t = db.execute("SELECT n FROM raid_tries_c WHERE uid=? AND ci=? AND day=?", (uid, ci, day_id())).fetchone()
    boss = raid_boss_of(ci, week)
    return {"name": RAID_BOSSES[boss][0], "boss": boss, "event": 1 if ev else 0, "immortal": 1, "total": tot, "chat": chat_label(ci),
            "me": {"dmg": my, "rank": rank, "tries": t[0] if t else 0},
            "top": [{"name": n or "Игрок", "dmg": d, "me": u == uid} for u, n, d in top],
            "over": bool(ev) and (ev[1] or ev[0] < time.time()),
            "endsAt": int(ev[0] * 1000) if ev else week_end_ms(week)}

def _player_room(uid):
    return (db.execute("SELECT room FROM players WHERE id=?", (uid,)).fetchone() or (0,))[0]

def raid_get(user, fields, given):
    with db_lock:
        ci, week = raid_key(fields, given)
        if not ci:
            if week == "noboss":
                return 200, {"noboss": 1}
            return 400, {"ok": False, "reason": "open the game from a group chat"}
        v = raid_view(ci, week, user["id"])
        db.commit()
        return 200, v

def raid_join(user, fields, body):
    with db_lock:
        ci, week = raid_key(fields, body.get("ci"))
        if not ci:
            if week == "noboss":
                return 200, {"noboss": 1}
            return 400, {"ok": False, "reason": "open the game from a group chat"}
        chat_label(ci)
        db.execute("INSERT OR IGNORE INTO raid_hits(ci, week, uid, dmg) VALUES(?,?,?,0)", (ci, week, user["id"]))
        db.commit()
        return 200, raid_view(ci, week, user["id"])

def raid_reward(dmg, room, event):
    """Paid right after every try, growing with damage compared to an average hero of that floor."""
    q = min(2.0, dmg / max(1, try_dmg(room)))
    gold = int((120 + room * 18) * q * (1.3 if event else 1))
    return {"gold": gold, "cores": (1 if q >= 0.6 else 0) + (1 if q >= 1.2 else 0)}

def raid_hit(user, fields, body):
    now, day = time.time(), day_id()
    with db_lock:
        ci, week = raid_key(fields, body.get("ci"))
        if not ci:
            if week == "noboss":
                return 200, {"noboss": 1}
            return 400, {"ok": False, "reason": "open the game from a group chat"}
        v = raid_view(ci, week, user["id"])
        if v["over"]:
            return 200, v
        # three tries a day in every chat separately
        t = db.execute("SELECT n, last FROM raid_tries_c WHERE uid=? AND ci=? AND day=?", (user["id"], ci, day)).fetchone()
        n, last = t if t else (0, 0)
        if n >= RAID_TRIES:
            return 200, v
        if now - last < RAID_MIN_GAP:
            return 429, {"ok": False, "reason": "too soon"}
        db.execute("INSERT OR REPLACE INTO raid_tries_c(uid, ci, day, n, last) VALUES(?,?,?,?,?)", (user["id"], ci, day, n + 1, now))
        room = max(_player_room(user["id"]), 1)
        # one 40 s try can't do more than ~3 average tries of the player's floor: forged numbers are cut
        # strong heroes do many times the average of their floor; only absurd numbers are cut
        dmg = min(as_int(body.get("dmg"), 0, 10**15), 15 * try_dmg(min(max(as_int(body.get("room"), 0, 100000), 1), room + 20)))
        if is_flagged(user["id"]):
            dmg = 0
        db.execute("""INSERT INTO raid_hits(ci, week, uid, dmg) VALUES(?,?,?,?)
                      ON CONFLICT(ci, week, uid) DO UPDATE SET dmg=dmg+excluded.dmg""", (ci, week, user["id"], dmg))
        db.execute("""INSERT INTO raid_stats(uid, ci, dmg, best, hits) VALUES(?,?,?,?,1)
                      ON CONFLICT(uid, ci) DO UPDATE SET dmg=dmg+excluded.dmg, best=MAX(best, excluded.best), hits=hits+1""",
                   (user["id"], ci, dmg, dmg))
        chat_label(ci)
        db.commit()
        v = raid_view(ci, week, user["id"])
    v["reward"] = raid_reward(dmg, room, week == -1)
    v["counted"] = dmg
    return 200, v

def raid_stats(user, given, fields):
    """Every chat this player has fought in: their damage there this week/event and their place."""
    with db_lock:
        here, _w = raid_key(fields, given)
        rows = db.execute("SELECT ci, dmg, best, hits FROM raid_stats WHERE uid=? ORDER BY dmg DESC LIMIT 20", (user["id"],)).fetchall()
        chats, total, best, hits = [], 0, 0, 0
        for ci, dmg, b, h in rows:
            total += dmg; best = max(best, b); hits += h
            wk = -1 if ci.startswith("g") else week_id()
            my = (db.execute("SELECT dmg FROM raid_hits WHERE ci=? AND week=? AND uid=?", (ci, wk, user["id"])).fetchone() or (0,))[0]
            rank = 1 + db.execute("SELECT COUNT(*) FROM raid_hits WHERE ci=? AND week=? AND dmg>?", (ci, wk, my)).fetchone()[0] if my else "—"
            chats.append({"name": chat_label(ci), "dmg": my, "all": dmg, "rank": rank, "here": ci == here})
        db.commit()
    return 200, {"total": total, "best": best, "hits": hits, "chats": chats}

def raid_claim(user, fields, body):
    return 200, {"ok": True}

def html_esc(t):
    return str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def mention(uid, name, username):
    """@username tags the player; without one, a link on the name still notifies them."""
    if username:
        return "@" + html_esc(username)
    return f'<a href="tg://user?id={int(uid)}">{html_esc(name or "Игрок")}</a>'

def close_event(ci):
    with db_lock:
        ev = db.execute("SELECT chat_id, closed FROM raid_events WHERE ci=?", (ci,)).fetchone()
        if not ev or ev[1]:
            return
        bname = RAID_BOSSES[raid_boss_of(ci, -1)][0]
        db.execute("UPDATE raid_events SET closed=1 WHERE ci=?", (ci,))
        top = db.execute("""SELECT h.uid, p.name, p.username, h.dmg FROM raid_hits h LEFT JOIN players p ON p.id=h.uid
                            WHERE h.ci=? AND h.week=-1 AND h.dmg>0 ORDER BY h.dmg DESC LIMIT 10""", (ci,)).fetchall()
        tot = db.execute("SELECT COALESCE(SUM(dmg),0) FROM raid_hits WHERE ci=? AND week=-1", (ci,)).fetchone()[0]
        db.commit()
    lines = "\n".join(f"{i + 1}. {mention(u, n, un)} — {d:,}".replace(",", " ") for i, (u, n, un, d) in enumerate(top)) or "—"
    try:
        tg("sendMessage", chat_id=ev[0], parse_mode="HTML",
           text=f"🔥 Ивент окончен! {html_esc(bname)} уходит.\nЧат нанёс {tot:,} урона.\n\nЛучшие бойцы:\n{lines}".replace(",", " "))
    except Exception as e:
        log.info("event close message: %s", e)

def _is_chat_admin(chat_id, uid):
    try:
        return tg("getChatMember", chat_id=chat_id, user_id=uid)["result"]["status"] in ("creator", "administrator")
    except Exception:
        return False

def _boss_btn(chat_id):
    return [{"text": "⚔️ Бить босса", "url": app_link("rg_" + str(chat_id).replace("-", "m"))}]

def _boss_running(ci):
    """Caller holds db_lock. Hours left of the running event, or None."""
    old = db.execute("SELECT ends, closed FROM raid_events WHERE ci=?", (ci,)).fetchone()
    if old and not old[1] and old[0] > time.time():
        return max(1, int((old[0] - time.time()) // 3600))
    return None

BOSS_HOURS = ((6, "6 ч"), (12, "12 ч"), (24, "24 ч"), (72, "3 дня"), (168, "7 дней"))

def _boss_menu(chat_id, ci):
    """The admin's panel: who is in the chat now, or whom to call."""
    with db_lock:
        left = _boss_running(ci)
        name = RAID_BOSSES[raid_boss_of(ci, -1)][0] if left else ""
    if left:
        return (f"🔥 {name} уже в чате, осталось ~{left} ч.",
                {"inline_keyboard": [_boss_btn(chat_id), [{"text": "⛔ Закончить сейчас", "callback_data": "bs:stop"}]]})
    k = list(RAID_BOSSES)
    bt = [{"text": RAID_BOSSES[b][0], "callback_data": "bs:b:" + b} for b in k] + [{"text": "🎲 Случайный", "callback_data": "bs:b:rnd"}]
    rows = [bt[i:i + 2] for i in range(0, len(bt), 2)]
    return "👹 Кого призываем в чат?\n\nБосс бессмертен: весь чат бьёт его наперегонки, у каждого 3 попытки в день. В конце бот покажет лучших.", {"inline_keyboard": rows}

def start_event(chat, frm, boss, hours):
    chat_id, ci = chat["id"], "g" + str(chat["id"])
    if boss not in RAID_BOSSES:
        boss = random.choice(list(RAID_BOSSES))
    with db_lock:
        if _boss_running(ci):
            return False
        db.execute("DELETE FROM raid_hits WHERE ci=? AND week=-1", (ci,))
        db.execute("DELETE FROM raid_tries_c WHERE ci=?", (ci,))      # a new boss: everyone gets fresh tries
        db.execute("INSERT OR REPLACE INTO raid_events(ci, chat_id, by_uid, ends, lvl, closed, title, boss) VALUES(?,?,?,?,?,0,?,?)",
                   (ci, chat_id, frm.get("id"), time.time() + hours * 3600, 1, (chat.get("title") or "Ивент чата")[:40], boss))
        db.commit()
    dur = dict(BOSS_HOURS).get(hours, f"{hours} ч")
    tg("sendMessage", chat_id=chat_id, reply_markup={"inline_keyboard": [_boss_btn(chat_id)]},
       text=f"🔥 {display_name(frm)} призывает {RAID_BOSSES[boss][1]} на {dur}!\n\nОн бессмертен: кто набьёт больше урона? "
            f"У каждого 3 попытки в день по 40 секунд, награда — сразу после каждого боя. В конце бот покажет лучших.")
    return True

def boss_command(msg):
    """/boss in a group, by its creator or an admin: buttons to pick the boss and the time.
    The old typed form still works: «/boss 12 дерув», «/boss стоп»."""
    chat, frm = msg["chat"], msg.get("from") or {}
    chat_id, ci = chat["id"], "g" + str(chat["id"])
    if not _is_chat_admin(chat_id, frm.get("id")):
        tg("sendMessage", chat_id=chat_id, reply_to_message_id=msg.get("message_id"), text="Призвать босса может только создатель или админ чата.")
        return
    words = [w.lower() for w in (msg.get("text") or "").split()[1:]]
    if any(w in ("стоп", "stop", "конец", "end") for w in words):
        with db_lock:
            run = db.execute("SELECT 1 FROM raid_events WHERE ci=? AND closed=0", (ci,)).fetchone()
        if run:
            close_event(ci)
            return
    elif words:
        hours, boss = 24, None
        for w in words:
            if w.isdigit():
                hours = max(1, min(168, int(w)))
            else:
                boss = next((k for k, v in RAID_BOSSES.items() if any(w.startswith(x) for x in v[2])), boss)
        if start_event(chat, frm, boss or "rnd", hours):
            return
    text, kb = _boss_menu(chat_id, ci)
    tg("sendMessage", chat_id=chat_id, text=text, reply_markup=kb)

def boss_callback(cq):
    """The buttons of the /boss panel: bs:b:<boss> → the time, bs:t:<boss>:<hours> → the boss comes, bs:stop, bs:back."""
    m = cq.get("message") or {}
    chat, frm = m.get("chat") or {}, cq.get("from") or {}
    chat_id, mid, ci = chat.get("id"), m.get("message_id"), "g" + str(chat.get("id"))
    if not _is_chat_admin(chat_id, frm.get("id")):
        tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Это кнопки для админов чата", show_alert=True)
        return
    parts = (cq.get("data") or "").split(":")
    if parts[1] == "b":
        b = parts[2]
        name = "Случайный босс" if b == "rnd" else RAID_BOSSES.get(b, ("?",))[0]
        rows = [[{"text": t, "callback_data": f"bs:t:{b}:{h}"} for h, t in BOSS_HOURS[:3]],
                [{"text": t, "callback_data": f"bs:t:{b}:{h}"} for h, t in BOSS_HOURS[3:]],
                [{"text": "← Назад", "callback_data": "bs:back"}]]
        tg_try("answerCallbackQuery", callback_query_id=cq["id"])
        tg_try("editMessageText", chat_id=chat_id, message_id=mid, text=f"👹 {name}. На сколько призываем?", reply_markup={"inline_keyboard": rows})
        return
    if parts[1] == "t":
        hours = max(1, min(168, as_int(parts[3], 24)))
        ok = start_event(chat, frm, parts[2], hours)
        tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Босс призван!" if ok else "Босс уже в чате")
        tg_try("deleteMessage", chat_id=chat_id, message_id=mid)
        if not ok:
            text, kb = _boss_menu(chat_id, ci)
            tg_try("sendMessage", chat_id=chat_id, text=text, reply_markup=kb)
        return
    if parts[1] == "stop":
        tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Босс уходит")
        tg_try("deleteMessage", chat_id=chat_id, message_id=mid)
        close_event(ci)
        return
    tg_try("answerCallbackQuery", callback_query_id=cq["id"])
    text, kb = _boss_menu(chat_id, ci)
    tg_try("editMessageText", chat_id=chat_id, message_id=mid, text=text, reply_markup=kb)

def bot_joined(msg):
    """The bot was added to a group: say how the boss is called."""
    tg_try("sendMessage", chat_id=msg["chat"]["id"],
           text="Привет! Я еБашня 🔥\n\nАдмины чата могут призвать сюда общего босса — весь чат бьёт его наперегонки. "
                "Нажми кнопку ниже или отправь /boss.",
           reply_markup={"inline_keyboard": [[{"text": "👹 Призвать босса", "callback_data": "bs:back"}]]})

# ---------------------------------------------------------------- admin notice shown to everyone above the room
def notice_get():
    with db_lock:
        r = db.execute("SELECT v FROM kv WHERE k='notice'").fetchone()
    try:
        n = json.loads(r[0]) if r else None
    except ValueError:
        n = None
    if not n or n.get("until", 0) < time.time():
        return 200, {"text": ""}
    return 200, {"text": n.get("text", ""), "ts": n.get("ts", 0)}

def notice_set(user, body):
    if user["id"] not in ADMIN_IDS:
        return 403, {"ok": False}
    text = str(body.get("text", "")).strip()[:140]
    hours = max(0.1, min(720.0, float(body.get("hours") or 24)))
    with db_lock:
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES('notice', ?)",
                   (json.dumps({"text": text, "ts": time.time(), "until": time.time() + hours * 3600}, ensure_ascii=False),))
        db.commit()
    log.info("notice set by %s: %r for %sh", user["id"], text, hours)
    return 200, {"ok": True}


# ---------------------------------------------------------------- season: an end date and prizes the owner announces
# The table is never reset: when the date passes, the three highest players win, the bot names them, and the owner starts the next season.
def _season():
    r = db.execute("SELECT v FROM kv WHERE k='season'").fetchone()
    try:
        return json.loads(r[0]) if r else None
    except ValueError:
        return None

def season_get():
    with db_lock:
        S = _season()
    if not S:
        return 200, {"season": None}
    return 200, {"season": {k: S.get(k) for k in ("n", "ends", "prizes", "note", "done", "winners")}}

SEASON_PLACES = 10

import re as _re
NFT_IMG_RE = _re.compile(r"^[a-z0-9]{2,40}-\d{1,7}$")
NFT_IMG_DIR = os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "nftimg")
_nft_lock = threading.Lock()

def nft_img(n):
    """Fragment keeps a picture of every gift at nft.fragment.com/gift/<name>-<number>.webp; we fetch it once."""
    f = os.path.join(NFT_IMG_DIR, n + ".webp")
    try:
        with open(f, "rb") as fh:
            return fh.read()
    except OSError:
        pass
    with _nft_lock:
        try:
            req = urllib.request.Request(f"https://nft.fragment.com/gift/{n}.webp", headers={"User-Agent": "Mozilla/5.0 (compatible; EmberspireBot)"})
            with urllib.request.urlopen(req, timeout=10) as r:
                data = r.read(3_000_000)
            if len(data) < 100 or data[:4] != b"RIFF":
                return None
            os.makedirs(NFT_IMG_DIR, exist_ok=True)
            with open(f + ".tmp", "wb") as fh:
                fh.write(data)
            os.replace(f + ".tmp", f)
            return data
        except Exception as e:
            log.info("nft img %s: %s", n, e)
            return None

def season_set(user, body):
    """Admin: {ends: unix seconds, prizes: [3 texts], note, new: true to start the next season}."""
    if user["id"] not in ADMIN_IDS:
        return 403, {"ok": False}
    with db_lock:
        S = _season() or {"n": 0}
        if body.get("new") or not S.get("n"):
            S = {"n": int(S.get("n") or 0) + 1}
        ends = float(body.get("ends") or 0)
        if ends < time.time() + 60:
            return 200, {"ok": False, "reason": "date"}
        # up to 10 prize places; a prize is a text, an NFT link (t.me/nft/…) or a picture link — the game shows those as a picture
        prizes = [str(x).strip()[:300] for x in (body.get("prizes") or [])][:SEASON_PLACES]
        while len(prizes) > 3 and not prizes[-1]:
            prizes.pop()
        S.update(ends=ends, prizes=prizes + [""] * (3 - len(prizes)), note=str(body.get("note") or "")[:140], done=False, winners=None)
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES('season', ?)", (json.dumps(S, ensure_ascii=False),))
        db.commit()
    log.info("season %s set by %s until %s", S["n"], user["id"], ends)
    return 200, {"ok": True, "season": S}

def season_close():
    """The date has passed: the best take the prizes (three, or as many places as have prizes); the bot tells the groups, the winners and the owner."""
    with db_lock:
        S = _season()
        if not S or S.get("done") or not S.get("ends") or S["ends"] > time.time():
            return
        places = max(3, len(S.get("prizes") or []))
        top = db.execute("""SELECT id, name, username, room FROM players WHERE flagged=0 AND room>0
                            ORDER BY room DESC, reached ASC LIMIT ?""", (places,)).fetchall()
        S["done"] = True
        S["winners"] = [{"name": n, "room": r} for _i, n, _u, r in top]
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES('season', ?)", (json.dumps(S, ensure_ascii=False),))
        chats = [r[0] for r in db.execute("SELECT DISTINCT chat_id FROM raid_events WHERE chat_id IS NOT NULL").fetchall()]
        db.commit()
    medals = ["🥇", "🥈", "🥉"] + [f"{i}." for i in range(4, 11)]
    pz = (S.get("prizes") or []) + [""] * 10
    lines = "\n".join(f"{medals[i]} {mention(u, n, un)} — этаж {r}" + (f" · {html_esc(pz[i])}" if pz[i] else "")
                      for i, (u, n, un, r) in enumerate(top)) or "—"
    text = f"🏆 Сезон {S['n']} окончен!\n\nЧемпионы башни:\n{lines}\n\nПоздравляем! Таблица остаётся — следующий сезон скоро."
    for cid in set(chats) | set(ADMIN_IDS) | ({CHANNEL} if CHANNEL else set()):
        try:
            tg("sendMessage", chat_id=cid, text=text, parse_mode="HTML")
        except Exception as e:
            log.info("season post to %s: %s", cid, e)
    for i, (u, n, un, r) in enumerate(top):
        _tell(u, f"🏆 Ты занял {i + 1} место в сезоне {S['n']} Пепельного Шпиля!" + (f"\nПриз: {pz[i]}" if pz[i] else "") +
              "\nОрганизатор свяжется с тобой.")

# ---------------------------------------------------------------- cloud save
# one copy per Telegram user: the copy that has played more wins, ties go to the newer one
# ---------------------------------------------------------------- one device at a time
# Every launch of the game has its own session id. Loading the save claims the account for that launch;
# from then on only it may write the save, and the device that played before gets «the game is open elsewhere».
db.execute("CREATE TABLE IF NOT EXISTS sessions(uid INTEGER PRIMARY KEY, sid TEXT, dev TEXT, ts REAL)")
db.commit()
SESSION_LEGACY = 180    # an old copy of the game (no session id) may still write while nobody has claimed the account this long

def _clean_id(v):
    v = str(v or "")[:40]
    return v if v.replace("-", "").replace("_", "").isalnum() else ""

def _session_ok(uid, sid):
    """Caller holds db_lock. True when this launch may write the save."""
    r = db.execute("SELECT sid, ts FROM sessions WHERE uid=?", (uid,)).fetchone()
    if not sid:
        return not r or time.time() - (r[1] or 0) > SESSION_LEGACY
    return not r or r[0] == sid

def session_ping(user, body):
    sid = _clean_id(body.get("sid"))
    with db_lock:
        r = db.execute("SELECT sid FROM sessions WHERE uid=?", (user["id"],)).fetchone()
        if r and sid and r[0] != sid:
            return 200, {"ok": False, "taken": True}
        if sid:
            db.execute("INSERT OR REPLACE INTO sessions(uid, sid, dev, ts) VALUES(?,?,?,?)",
                       (user["id"], sid, _clean_id(body.get("dev")), time.time()))
            db.commit()
    return 200, {"ok": True}

def save_get(user, q=None):
    q = q or {}
    sid, dev = _clean_id((q.get("sid") or [""])[0]), _clean_id((q.get("dev") or [""])[0])
    with db_lock:
        if sid:
            # this launch takes the account over: the other device is told at its next save or ping
            db.execute("INSERT OR REPLACE INTO sessions(uid, sid, dev, ts) VALUES(?,?,?,?)", (user["id"], sid, dev, time.time()))
            db.commit()
        r = db.execute("SELECT data, score, ts FROM saves WHERE uid=?", (user["id"],)).fetchone()
        w = _wipe_of(user["id"])
        last_dev = _kv_get(f"sdev:{user['id']}", "") or ""
    out = {"wipe": w} if w else {}
    out["dev"] = last_dev
    if not r:
        return 200, out
    try:
        return 200, dict(out, save=json.loads(r[0]), score=r[1], ts=r[2])
    except ValueError:
        return 200, out

# ---------------------------------------------------------------- wipes by the owner: one player (/сброс @ник) or everyone (admin panel)
# A wipe is a mark in time (ms). Any save of an older generation is refused and the game on the phone starts over by itself.
# Stars, bought skips and the class change stay: they were paid for.
def _wipe_of(uid):
    """Caller holds db_lock."""
    a = db.execute("SELECT v FROM kv WHERE k='wipe_all'").fetchone()
    b = db.execute("SELECT wipe_at FROM players WHERE id=?", (uid,)).fetchone()
    return max(float(a[0]) if a else 0, float(b[0] or 0) if b else 0)

_WIPE_COLS = "room=0, level=1, kills=0, bosses=0, wins=0, reached=NULL"

def wipe_player(uid):
    ts = time.time() * 1000
    with db_lock:
        db.execute(f"UPDATE players SET wipe_at=?, {_WIPE_COLS} WHERE id=?", (ts, uid))
        db.execute("DELETE FROM saves WHERE uid=?", (uid,))
        db.execute("DELETE FROM kv WHERE k LIKE ?", (f"qb:{uid}:%",))
        db.execute("DELETE FROM ac_state WHERE uid=?", (uid,))
        db.commit()
    log.warning("wipe: player %s", uid)

def wipe_all():
    ts = time.time() * 1000
    with db_lock:
        n = db.execute("SELECT COUNT(*) FROM saves").fetchone()[0]
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES('wipe_all', ?)", (str(ts),))
        db.execute(f"UPDATE players SET {_WIPE_COLS}")
        db.execute("DELETE FROM saves")
        db.execute("DELETE FROM kv WHERE k LIKE 'qb:%'")
        db.execute("DELETE FROM ac_state")
        db.commit()
    log.warning("wipe: EVERYONE (%s saves)", n)
    return n

def find_player(q):
    """@username, username or a numeric id. Caller holds db_lock."""
    q = str(q or "").strip().lstrip("@")
    if not q:
        return None
    if q.isdigit():
        r = db.execute("SELECT id, name, username, room, level FROM players WHERE id=?", (int(q),)).fetchone()
        if r:
            return r
    return db.execute("SELECT id, name, username, room, level FROM players WHERE lower(username)=lower(?)", (q,)).fetchone()

def admin_wipe(user, body):
    if user["id"] not in ADMIN_IDS:
        return 403, {"ok": False}
    if body.get("all"):
        if str(body.get("confirm") or "").strip().upper() != "СБРОС":
            return 400, {"ok": False, "reason": "confirm"}
        return 200, {"ok": True, "n": wipe_all()}
    with db_lock:
        r = find_player(body.get("who"))
    if not r:
        return 404, {"ok": False, "reason": "not found"}
    wipe_player(r[0])
    return 200, {"ok": True, "name": r[1], "username": r[2], "room": r[3]}

def wipe_command(msg):
    """/сброс @ник (or id): the owner sees who it is and confirms with a button."""
    chat = msg["chat"]["id"]
    if (msg.get("from") or {}).get("id") not in ADMIN_IDS:
        return
    arg = (msg.get("text") or "").split(maxsplit=1)
    if len(arg) < 2:
        tg_try("sendMessage", chat_id=chat, text="Напиши так: /сброс @ник или /сброс 123456789 (id игрока).\nСбросить всех — кнопкой в админке игры.")
        return
    with db_lock:
        r = find_player(arg[1])
    if not r:
        tg_try("sendMessage", chat_id=chat, text=f"Игрок {arg[1]} не найден. Ник ищется только у тех, кто хоть раз открывал игру; можно указать id.")
        return
    uid, name, un, room, lvl = r
    tg_try("sendMessage", chat_id=chat, parse_mode="HTML",
           text=f"Сбросить прогресс {mention(uid, name, un)} ({html_esc(name or '')}, id {uid})?\nСейчас: этаж {room}, уровень {lvl}.\n\nГерой, вещи и этажи пропадут, из топа он уйдёт. Звёзды и пропуски останутся.",
           reply_markup={"inline_keyboard": [[{"text": "Сбросить", "callback_data": f"wp:go:{uid}"}, {"text": "Отмена", "callback_data": f"wp:no:{uid}"}]]})

def wipe_callback(cq):
    me = (cq.get("from") or {}).get("id")
    m = cq.get("message") or {}
    chat, mid = m.get("chat", {}).get("id"), m.get("message_id")
    if me not in ADMIN_IDS:
        tg_try("answerCallbackQuery", callback_query_id=cq["id"])
        return
    _, act, uid = (cq.get("data") or "").split(":", 2)
    if act != "go":
        tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Отменено")
        tg_try("editMessageText", chat_id=chat, message_id=mid, text="Сброс отменён.")
        return
    wipe_player(int(uid))
    tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Сброшено")
    tg_try("editMessageText", chat_id=chat, message_id=mid, text=f"Готово: прогресс игрока id {uid} сброшен. При следующем входе (или в течение пары секунд, если он сейчас в игре) он начнёт с первого этажа.")

def _save_gen(d):
    try:
        if isinstance(d, str):
            d = json.loads(d)
        g = float(d.get("gen") or 0)
        return min(g, time.time() * 1000 + 60000)
    except Exception:
        return 0

def _restart_hero(uid, new, old_raw):
    """A «Новая игра»: the tower records follow the new hero (the leaderboard and the podium drop the old floor),
    and today's quests keep the fights already won today. Caller holds db_lock."""
    st = new.get("st") or {}
    room = as_int(new.get("maxCleared"), 0, 10**7)
    db.execute("""UPDATE players SET room=?, level=?, kills=?, bosses=?, wins=?, cls=?, reached=?, updated=? WHERE id=?""",
               (room, as_int(new.get("level"), 1, 10000), as_int(st.get("kills")), as_int(st.get("bosses")), as_int(st.get("wins")),
                str(new.get("cls") or "")[:20], time.time(), time.time(), uid))
    try:
        old = json.loads(old_raw) if old_raw else {}
    except Exception:
        old = {}
    k = f"qb:{uid}:{q_day()}"
    r = db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    if r:
        done_today = max(0, as_int((old.get("st") or {}).get("wins"), 0, 10**9) - as_int(r[0], -10**9))
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (k, str(as_int(st.get("wins"), 0, 10**9) - done_today)))
    db.execute("DELETE FROM ac_state WHERE uid=?", (uid,))
    log.info("hero restarted by %s: floor %s", uid, room)

def save_put(user, body):
    data = body.get("save")
    if not isinstance(data, dict):
        return 400, {"ok": False}
    raw = json.dumps(data, ensure_ascii=False)
    try:
        score = float(body.get("score") or 0)
        ts = min(float(body.get("ts") or 0), time.time() * 1000 + 60000)
    except (ValueError, TypeError):
        return 400, {"ok": False}
    sid, dev = _clean_id(body.get("sid")), _clean_id(body.get("dev"))
    with db_lock:
        if not _session_ok(user["id"], sid):
            return 200, {"ok": 0, "taken": True}
        _qbase(user["id"]); _qbase_f(user["id"], "ekills"); _qbase_f(user["id"], "bkills")          # today's starting point for the daily quests, taken from the save before it changes
        cur = db.execute("SELECT score, ts, data FROM saves WHERE uid=?", (user["id"],)).fetchone()
        # «Новая игра» starts a new generation of the hero: a newer generation replaces the old save whatever its score,
        # and an older one (a phone that still holds the hero from before the restart) can no longer overwrite it
        gen = _save_gen(data)
        cur_gen = _save_gen(cur[2]) if cur else 0
        w = _wipe_of(user["id"])
        if w and gen < w:
            return 200, {"ok": 0, "wipe": w}
        if cur and gen < cur_gen:
            return 200, {"ok": 0, "score": cur[0], "gen": cur_gen}
        if cur and gen == cur_gen and (cur[0] > score or (cur[0] == score and cur[1] > ts)):
            return 200, {"ok": 0, "score": cur[0]}
        if cur and gen > cur_gen:
            _restart_hero(user["id"], data, cur[2])
        db.execute("INSERT OR REPLACE INTO saves(uid, data, score, ts) VALUES(?,?,?,?)", (user["id"], raw, score, ts))
        if dev:
            _kv_set(f"sdev:{user['id']}", dev)       # which device wrote last: another device starting up takes this save as it is
        if sid:
            db.execute("UPDATE sessions SET ts=? WHERE uid=? AND sid=?", (time.time(), user["id"], sid))
        if not cur:
            _qbase(user["id"]); _qbase_f(user["id"], "ekills"); _qbase_f(user["id"], "bkills")      # the very first save: today's quests count from it
        db.commit()
    ac_enqueue(user["id"], time.time())
    return 200, {"ok": 1}

# ---------------------------------------------------------------- reminders
def notify_set(user, body):
    on = 1 if body.get("on") else 0
    with db_lock:
        db.execute("UPDATE players SET notify=?, notify_off=?, can_pm=CASE WHEN ?=1 THEN 1 ELSE can_pm END WHERE id=?", (on, 1 - on, on, user["id"]))
        db.commit()
    return 200, {"ok": True}

def rest_set(user, body):
    at = as_int(body.get("at"), 0, 10**14) / 1000.0
    with db_lock:
        now = time.time()
        db.execute("UPDATE players SET rest_at=? WHERE id=?", (max(at, now) if now - 120 < at < now + 86400 else 0, user["id"]))
        db.commit()
    return 200, {"ok": True}

def reminder_loop():
    while True:
        time.sleep(15)
        now = time.time()
        try:
            with db_lock:
                # only those away for a while, at most once per REMIND_EVERY; the game reports rest_at whenever it is closed
                due = db.execute("""SELECT id, room FROM players WHERE notify=1 AND can_pm=1 AND rest_at>0 AND rest_at<=?
                                    AND seen<=? AND reminded<?""", (now, now - REMIND_AWAY, now - REMIND_EVERY)).fetchall()
                for (uid, _r) in due:
                    db.execute("UPDATE players SET reminded=?, rest_at=0 WHERE id=?", (now, uid))
                db.commit()
            for (uid, room) in due:
                try:
                    tg("sendMessage", chat_id=uid, text="⚔️ Герой отдохнул и готов к бою!" + (f" Комната {room + 1} ждёт." if room else " Башня ждёт!"),
                       reply_markup={"inline_keyboard": [[{"text": "Войти в башню", "web_app": {"url": WEBAPP_URL}}]]})
                except Exception as e:
                    log.info("reminder to %s not sent: %s", uid, e)
        except Exception as e:
            log.warning("reminder loop: %s", e)

# ---------------------------------------------------------------- challenge card shared to a chat
def share_prepare(user, body):
    """Turn the game's card into a JPEG Telegram can fetch, and prepare a message with the "Войти в башню" button."""
    if not rate_ok(user["id"], "share"):
        return SLOW(user["id"], "share")
    text, image, link = str(body.get("text", ""))[:900], str(body.get("image", "")), str(body.get("link", ""))
    if not link.startswith("https://t.me/") or not image.startswith("data:image/png;base64,"):
        return 400, {"ok": False}
    try:
        from PIL import Image
    except ImportError:
        return 503, {"ok": False, "reason": "python3-pil is not installed"}
    try:
        raw = base64.b64decode(image.split(",", 1)[1], validate=True)
        if len(raw) > 400_000:
            return 413, {"ok": False}
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        if im.width > 1000 or im.height > 1000:
            return 413, {"ok": False}
        im = im.resize((im.width * 3, im.height * 3), Image.NEAREST)
        name = hashlib.sha256(raw).hexdigest()[:24] + ".jpg"
        im.save(os.path.join(CARDS, name), "JPEG", quality=90)
    except Exception as e:
        log.info("bad card from %s: %s", user["id"], e)
        return 400, {"ok": False}
    url = WEBAPP_URL + "cards/" + name
    did = str(body.get("duel") or "")
    rid = ("duel_" + did) if did.isalnum() and len(did) <= 16 else name[:24]
    result = {"type": "photo", "id": rid, "photo_url": url, "thumbnail_url": url, "caption": text,
              "reply_markup": {"inline_keyboard": [[{"text": "⚔️ Принять вызов" if body.get("button") == "duel" else "Войти в башню", "url": link}]]}}
    try:
        r = tg("savePreparedInlineMessage", user_id=user["id"], result=result,
               allow_user_chats=True, allow_group_chats=True, allow_channel_chats=True, allow_bot_chats=False)
        return 200, {"id": r["result"]["id"]}
    except Exception as e:
        log.warning("savePreparedInlineMessage: %s", e)
        return 502, {"ok": False}

def cards_cleanup():
    cutoff = time.time() - 14 * 86400
    for n in os.listdir(CARDS):
        p = os.path.join(CARDS, n)
        try:
            if os.path.getmtime(p) < cutoff:
                os.remove(p)
        except OSError:
            pass


# ---------------------------------------------------------------- duels
# Anyone can be challenged at any moment: the heroes fight as their latest cloud saves have them dressed and trained.
# The fight itself is the game's own engine (duel_engine.js runs the page's logic script with Node.js).
import subprocess, shutil
db.execute("""CREATE TABLE IF NOT EXISTS duels(id TEXT PRIMARY KEY, from_uid INTEGER, from_snap TEXT, created REAL,
              to_uid INTEGER, to_snap TEXT, result TEXT, done_at REAL, from_claimed INTEGER DEFAULT 0)""")
for col, typ in [("kind", "TEXT DEFAULT 'link'"), ("declined", "INTEGER DEFAULT 0")]:
    try:
        db.execute(f"ALTER TABLE duels ADD COLUMN {col} {typ}")
    except sqlite3.OperationalError:
        pass
try:
    db.execute("ALTER TABLE players ADD COLUMN dtag TEXT")
except sqlite3.OperationalError:
    pass
db.execute("CREATE INDEX IF NOT EXISTS duels_from ON duels(from_uid, created)")
db.execute("CREATE INDEX IF NOT EXISTS duels_to ON duels(to_uid, done_at)")
db.execute("UPDATE duels SET from_claimed=1 WHERE kind='direct' AND result IS NOT NULL AND from_claimed=0 AND done_at<?", (1793000000,))
db.execute("CREATE TABLE IF NOT EXISTS duel_paid(uid INTEGER, day INTEGER, n INTEGER, PRIMARY KEY(uid, day))")
db.commit()
# ---------------------------------------------------------------- anti-spam (v194)
# In memory, per player: how many times an action was done in a sliding window. A restart forgets it, which is fine.
import collections
_rl_lock = threading.Lock()
_rl_hits = collections.defaultdict(collections.deque)
RL = {                       # action: (times, seconds)
    "post": (150, 60),       # any request that changes something: far above what playing needs
    "duel_new": (10, 3600), "duel_direct": (1, 15), "duel_answer": (30, 60),
    "gr_new": (6, 600), "gr_join": (20, 60), "gr_public": (8, 600), "gr_start": (10, 60), "gr_kick": (20, 60),
    "share": (12, 60), "duel_card": (12, 60), "ghost": (20, 60),
    "gr_notify": (3, 3600),  # a host may call players by bot message to three groups an hour (admins too)
}
def rate_ok(uid, key, now=None):
    """True and counted when the player may do this now; False when he has done it too often lately."""
    if uid in ADMIN_IDS and key != "gr_notify":
        return True
    n, sec = RL[key]
    now = now or time.time()
    with _rl_lock:
        q = _rl_hits[(uid, key)]
        while q and now - q[0] > sec:
            q.popleft()
        if len(q) >= n:
            return False
        q.append(now)
        if len(_rl_hits) > 200_000:          # a forgotten-player sweep, so memory never grows without bound
            for k in [k for k, v in _rl_hits.items() if not v or now - v[-1] > 3600]:
                del _rl_hits[k]
        return True

def rate_wait(uid, key):
    n, sec = RL[key]
    with _rl_lock:
        q = _rl_hits.get((uid, key))
        return max(1, int(sec - (time.time() - q[0]))) if q else 1

SLOW = lambda uid, key: (200, {"ok": False, "reason": "slow", "wait": rate_wait(uid, key)})
DUEL_PM_PER_DAY = 10         # challenge messages one player gets from the bot a day; past that the challenge waits in the game

DUEL_OPEN_MAX = 3            # open challenge links per player
DUEL_TTL = 3 * 86400         # an unanswered link expires
DUEL_PAID_PER_DAY = 5        # duels a day that pay gold (to each player)
DUEL_DIRECT_PER_DAY = 15     # direct challenges a player may throw a day
DUEL_SAME_GAP = 3600         # the same opponent once an hour
ENGINE = os.path.join(HERE, "duel_engine.js")
NODE = shutil.which("node") or shutil.which("nodejs")

def engine(q):
    if not NODE:
        log.warning("duels need Node.js: apt install -y nodejs")
        return None
    try:
        p = subprocess.run([NODE, ENGINE], input=json.dumps(q).encode(), capture_output=True, timeout=40)
        r = json.loads(p.stdout.decode() or "{}")
    except Exception as e:
        log.warning("duel engine: %s", e)
        return None
    if r.get("error"):
        log.warning("duel engine: %s", r["error"])
        return None
    return r

def _save_of(uid):
    r = db.execute("SELECT data FROM saves WHERE uid=?", (uid,)).fetchone()
    try:
        sv = json.loads(r[0]) if r else None
    except ValueError:
        sv = None
    return sv if isinstance(sv, dict) and sv.get("cls") and isinstance(sv.get("inv"), list) else None

def _look(sv):
    eq, inv = sv.get("eq") or {}, sv.get("inv") or []
    out = {"cls": str(sv.get("cls", "knight"))[:16]}
    for k, slot in (("w", "weapon"), ("a", "armor"), ("h", "helmet"), ("b", "boots")):
        it = next((i for i in inv if isinstance(i, dict) and i.get("slot") == slot and eq.get(slot) == i.get("uid")), None)
        if it:
            out[k] = {"tid": str(it.get("tid", ""))[:32], "r": as_int(it.get("rarity"), 0, 5)}
    return out

def _card(uid, sv, st=None):
    p = db.execute("SELECT name, room FROM players WHERE id=?", (uid,)).fetchone() or ("Игрок", 0)
    c = {"name": p[0], "room": p[1], "cls": str(sv.get("cls", "knight"))[:16], "level": as_int(sv.get("level"), 1, 100000), "look": _look(sv),
         "tag": _tag(uid)}
    if st:
        c.update(power=st.get("power", 0), hp=st.get("hp", 0))
    return c

def _tag(uid):
    r = db.execute("SELECT dtag FROM players WHERE id=?", (uid,)).fetchone()
    if r and r[0]:
        return r[0]
    t = base64.urlsafe_b64encode(os.urandom(6)).decode().replace("-", "x").replace("_", "y")
    db.execute("UPDATE players SET dtag=? WHERE id=?", (t, uid))
    return t

def _pay(uid, room, won):
    """Gold for the first duels of the day; the counter is per player."""
    day = day_id()
    n = (db.execute("SELECT n FROM duel_paid WHERE uid=? AND day=?", (uid, day)).fetchone() or (0,))[0]
    if n >= DUEL_PAID_PER_DAY:
        return 0
    db.execute("INSERT OR REPLACE INTO duel_paid(uid, day, n) VALUES(?,?,?)", (uid, day, n + 1))
    room = max(1, room)
    return int((60 + room * 9) if won else (20 + room * 3))

# ---------------------------------------------------------------- anti-cheat
# The game runs on the phone, so the server checks what it receives. A long-running Node worker (ac_worker.js) applies the
# game's own rules: skill points, item levels and stats against the most the game can make, and whether the hero can really
# beat the boss of a floor it claims. The server adds what only it knows: real time between saves.
# A suspect gets a record in ac_flags. In 'watch' mode nothing happens to the player, the owner just sees the list;
# in 'enforce' mode the suspect leaves the leaderboard and the season, and can't duel, haunt floors or hit raid bosses.
import queue, select
AC_WORKER = os.path.join(HERE, "ac_worker.js")
AC_SEC_PER_WIN = float(os.environ.get("AC_SEC_PER_WIN", "1.0"))   # no fight is won faster than this, even by a monster of a hero
AC_WIN_SLACK = 60
AC_CANWIN_STEP = 50                                                  # re-check the boss each time the record grows this much
AC_VER = "1"
db.execute("""CREATE TABLE IF NOT EXISTS ac_flags(uid INTEGER PRIMARY KEY, ts REAL, status TEXT, reasons TEXT,
  kinds TEXT, cleared TEXT DEFAULT '', notified REAL DEFAULT 0, info TEXT)""")
db.execute("CREATE TABLE IF NOT EXISTS ac_state(uid INTEGER PRIMARY KEY, wins INTEGER, ts REAL, checked INTEGER DEFAULT 0)")
db.commit()

class _ACWorker:
    def __init__(self):
        self.p, self.lock = None, threading.Lock()
    def _start(self):
        self.p = subprocess.Popen([NODE, AC_WORKER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=HERE)
    def call(self, q, timeout=60):
        if not NODE:
            return None
        with self.lock:
            for attempt in (0, 1):
                try:
                    if not self.p or self.p.poll() is not None:
                        self._start()
                    self.p.stdin.write((json.dumps(q) + "\n").encode())
                    self.p.stdin.flush()
                    r, _w, _x = select.select([self.p.stdout], [], [], timeout)
                    if not r:
                        raise TimeoutError("worker timeout")
                    line = self.p.stdout.readline()
                    if not line:
                        raise EOFError("worker gone")
                    out = json.loads(line.decode())
                    if out.get("error"):
                        log.warning("ac worker: %s", out["error"])
                        return None
                    return out
                except Exception as e:
                    log.warning("ac worker (%s): %s", attempt, e)
                    try:
                        self.p.kill()
                    except Exception:
                        pass
                    self.p = None
            return None
AC = _ACWorker()
ac_queue = queue.Queue()
_ac_waiting = set()

def ac_mode():
    r = db.execute("SELECT v FROM kv WHERE k='ac_mode'").fetchone()
    return r[0] if r and r[0] in ("watch", "enforce") else "watch"

def ac_enqueue(uid, ts):
    if uid not in _ac_waiting:
        _ac_waiting.add(uid)
        ac_queue.put((uid, ts))

def _ac_dur(sec):
    return (f"{int(sec // 3600)} ч {int(sec % 3600 // 60)} мин" if sec >= 3600 else
            f"{int(sec // 60)} мин" if sec >= 60 else f"{max(1, int(sec))} с")

def ac_check(uid, recv_ts, retro=False):
    """Checks the stored save of one player; returns the list of issues found (also stored and reported)."""
    with db_lock:
        sv = _save_of(uid)
        stt = db.execute("SELECT wins, ts, checked FROM ac_state WHERE uid=?", (uid,)).fetchone()
    if not sv:
        return []
    r = AC.call({"op": "check", "save": sv})
    if not r:
        return []
    issues = list(r.get("issues") or [])
    wins, floor = int(r.get("wins") or 0), int(r.get("floor") or 0)
    # real time: wins can't grow faster than one per AC_SEC_PER_WIN seconds
    if stt and not retro:
        dw, dt = wins - (stt[0] or 0), recv_ts - (stt[1] or recv_ts)
        if dw > dt / AC_SEC_PER_WIN + AC_WIN_SLACK:
            issues.append({"k": "speed", "hard": True, "msg": f"+{dw} побед за {_ac_dur(dt)}"})
    checked = stt[2] if stt else 0
    # the boss of the claimed floor, tried with the real engine; a fail is checked again lower before it counts
    if floor >= 50 and floor >= (checked or 0) + AC_CANWIN_STEP:
        w = AC.call({"op": "canwin", "save": sv, "room": floor, "seeds": 4}, timeout=120)
        if w and not w.get("wins"):
            low = AC.call({"op": "canwin", "save": sv, "room": int(floor * 0.7), "seeds": 4}, timeout=120)
            hard = bool(low and not low.get("wins") and low.get("room", 0) >= 50)
            issues.append({"k": "canwin", "hard": hard,
                           "msg": f"герой не проходит босса {w['room']} этажа" + (f" и даже {low['room']}" if hard else "")})
        if w:
            checked = floor
    with db_lock:
        db.execute("INSERT OR REPLACE INTO ac_state(uid, wins, ts, checked) VALUES(?,?,?,?)", (uid, wins, recv_ts, checked))
        db.commit()
    ac_record(uid, issues, {"power": r.get("power"), "level": r.get("level"), "floor": floor, "wins": wins})
    return issues

def ac_record(uid, issues, info):
    hard = [i for i in issues if i.get("hard")]
    soft = [i for i in issues if not i.get("hard")]
    if soft:
        log.info("ac soft %s: %s", uid, "; ".join(i["msg"] for i in soft))
    if not hard:
        return
    log.warning("ac HARD %s: %s", uid, "; ".join(i["msg"] for i in hard))
    if uid in ADMIN_IDS:
        return                           # the owner's tests (floor jumps, given items) are not cheating
    kinds = sorted({i["k"] for i in hard})
    now = time.time()
    with db_lock:
        row = db.execute("SELECT status, reasons, cleared, notified FROM ac_flags WHERE uid=?", (uid,)).fetchone()
        if row and row[0] == "cleared" and set(kinds) <= set((row[2] or "").split(",")):
            return                       # the owner already looked at exactly this and let it go
        old = json.loads(row[1]) if row and row[1] else []
        msgs = [i["msg"] for i in hard]
        reasons = (msgs + [m for m in old if m not in msgs])[:8]
        status = "banned" if row and row[0] == "banned" else "open"
        notify = not row or row[0] == "cleared"          # "notified" keeps the moment the suspicion appeared
        db.execute("""INSERT INTO ac_flags(uid, ts, status, reasons, kinds, cleared, notified, info) VALUES(?,?,?,?,?,?,?,?)
                      ON CONFLICT(uid) DO UPDATE SET ts=excluded.ts, status=excluded.status, reasons=excluded.reasons,
                      kinds=excluded.kinds, notified=excluded.notified, info=excluded.info""",
                   (uid, now, status, json.dumps(reasons, ensure_ascii=False), ",".join(kinds), row[2] if row else "",
                    now if notify else (row[3] if row else 0), json.dumps(info)))
        if ac_mode() == "enforce" or status == "banned":
            db.execute("UPDATE players SET flagged=1 WHERE id=?", (uid,))
        p = db.execute("SELECT name, username, room FROM players WHERE id=?", (uid,)).fetchone()
        mode = ac_mode()
        db.commit()
    # no message per player: the owner gets one summary a day (ac_digest_loop)

AC_DIGEST_HOUR = int(os.environ.get("AC_DIGEST_HOUR", "12"))      # local hour of the daily summary
AC_TZ = float(os.environ.get("AC_TZ", "3"))                         # owner's time zone, hours from UTC

def ac_digest():
    """One message: who was newly suspected since the last summary, and how many are still waiting for a decision."""
    with db_lock:
        r = db.execute("SELECT v FROM kv WHERE k='ac_digest_ts'").fetchone()
        since = float(r[0]) if r else 0.0
        new = db.execute("""SELECT f.uid, f.reasons, p.name, p.username, p.room FROM ac_flags f LEFT JOIN players p ON p.id=f.uid
                            WHERE f.status='open' AND f.notified>? ORDER BY p.room DESC LIMIT 20""", (since,)).fetchall()
        n_open = db.execute("SELECT COUNT(*) FROM ac_flags WHERE status='open'").fetchone()[0]
        mode = ac_mode()
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES('ac_digest_ts', ?)", (str(time.time()),))
        db.commit()
    lines = [f"• {mention(u, n or 'Игрок', un)} (этаж {rm or 0}): " + html_esc("; ".join(json.loads(rs or "[]")[:2]))
             for u, rs, n, un, rm in new]
    txt = ("🛡 Анти-чит за сутки\n\n" +
           (f"Новых подозрительных: {len(new)}\n" + "\n".join(lines) if new else "Новых подозрительных нет.") +
           f"\n\nВсего ждут решения: {n_open}." +
           ("\nРежим наблюдения: игроки ничего не замечают." if mode == "watch" else "\nРежим наказания: подозреваемые скрыты из топа и дуэлей.") +
           ("\nРешить: игра → ⚙ Меню → Анти-чит." if n_open else ""))
    for a in ADMIN_IDS:
        try:
            tg("sendMessage", chat_id=a, text=txt, parse_mode="HTML")
        except Exception as e:
            log.info("ac digest: %s", e)

def ac_digest_loop():
    while True:
        try:
            lt = time.gmtime(time.time() + AC_TZ * 3600)
            day = time.strftime("%Y-%m-%d", lt)
            if lt.tm_hour >= AC_DIGEST_HOUR:
                with db_lock:
                    r = db.execute("SELECT v FROM kv WHERE k='ac_digest_day'").fetchone()
                    due = not r or r[0] != day
                    if due:
                        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES('ac_digest_day', ?)", (day,))
                        db.commit()
                if due:
                    ac_digest()
        except Exception as e:
            log.warning("ac digest: %s", e)
        time.sleep(60)

def ac_loop():
    while True:
        uid, ts = ac_queue.get()
        _ac_waiting.discard(uid)
        try:
            ac_check(uid, ts)
        except Exception as e:
            log.warning("ac check %s: %s", uid, e)

def ac_scan():
    """Once per rules version: every stored hero is checked; the owner gets one summary instead of a message per player."""
    time.sleep(20)
    with db_lock:
        r = db.execute("SELECT v FROM kv WHERE k='ac_scan'").fetchone()
        if r and r[0] == AC_VER:
            return
        uids = [x[0] for x in db.execute("SELECT uid FROM saves")]
    ac_record.quiet = True
    found = []
    try:
        for uid in uids:
            try:
                iss = [i for i in ac_check(uid, time.time(), retro=True) if i.get("hard")]
                if iss and uid not in ADMIN_IDS:
                    found.append((uid, iss))
            except Exception as e:
                log.warning("ac scan %s: %s", uid, e)
    finally:
        ac_record.quiet = False
    with db_lock:
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES('ac_scan', ?)", (AC_VER,))
        names = {u: db.execute("SELECT name, username, room FROM players WHERE id=?", (u,)).fetchone() for u, _ in found}
        db.commit()
    lines = []
    for u, iss in found[:25]:
        p = names.get(u) or ("Игрок", None, 0)
        lines.append(f"• {mention(u, p[0], p[1])} (этаж {p[2]}): " + html_esc("; ".join(i["msg"] for i in iss[:2])))
    txt = (f"🛡 Анти-чит проверил всех игроков ({len(uids)}).\n" +
           (f"Подозрительных: {len(found)}\n" + "\n".join(lines) if found else "Подозрительных нет.") +
           "\n\nСейчас режим наблюдения: игроки ничего не заметили. Список и решения: игра → ⚙ Меню → Анти-чит.")
    for a in ADMIN_IDS:
        try:
            tg("sendMessage", chat_id=a, text=txt, parse_mode="HTML")
        except Exception as e:
            log.info("ac summary: %s", e)

def ac_admin_get(user):
    if user["id"] not in ADMIN_IDS:
        return 403, {"ok": False}
    with db_lock:
        rows = db.execute("""SELECT f.uid, f.ts, f.status, f.reasons, f.info, p.name, p.username, p.room, p.cls FROM ac_flags f
                             LEFT JOIN players p ON p.id=f.uid ORDER BY CASE f.status WHEN 'open' THEN 0 WHEN 'banned' THEN 1 ELSE 2 END, f.ts DESC
                             LIMIT 60""").fetchall()
        mode = ac_mode()
    out = []
    for uid, ts, st, rs, info, name, un, room, cls in rows:
        out.append({"uid": uid, "ts": ts, "status": st, "reasons": json.loads(rs or "[]"), "info": json.loads(info or "{}"),
                    "name": name or "Игрок", "username": un, "room": room or 0, "cls": cls})
    return 200, {"ok": True, "mode": mode, "rows": out}

def ac_admin_set(user, body):
    if user["id"] not in ADMIN_IDS:
        return 403, {"ok": False}
    act, uid = str(body.get("action", "")), as_int(body.get("uid"), 0, 10**13)
    with db_lock:
        if act == "mode":
            mode = "enforce" if body.get("mode") == "enforce" else "watch"
            db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES('ac_mode', ?)", (mode,))
            db.execute("UPDATE players SET flagged=0 WHERE id IN (SELECT uid FROM ac_flags WHERE status<>'banned')")
            if mode == "enforce":
                db.execute("UPDATE players SET flagged=1 WHERE id IN (SELECT uid FROM ac_flags WHERE status='open')")
            db.execute("UPDATE players SET flagged=1 WHERE id IN (SELECT uid FROM ac_flags WHERE status='banned')")
        elif act == "clear":
            db.execute("UPDATE ac_flags SET status='cleared', cleared=kinds WHERE uid=?", (uid,))
            db.execute("UPDATE players SET flagged=0 WHERE id=?", (uid,))
        elif act == "ban":
            db.execute("UPDATE ac_flags SET status='banned' WHERE uid=?", (uid,))
            db.execute("UPDATE players SET flagged=1 WHERE id=?", (uid,))
        elif act == "rescan":
            db.execute("DELETE FROM kv WHERE k='ac_scan'")
            db.execute("UPDATE ac_state SET checked=0")
        else:
            return 400, {"ok": False}
        db.commit()
    log.info("ac admin %s: %s %s", user["id"], act, uid or body.get("mode"))
    if act == "rescan":
        threading.Thread(target=ac_scan, daemon=True).start()
    return ac_admin_get(user)

def is_flagged(uid):
    r = db.execute("SELECT flagged FROM players WHERE id=?", (uid,)).fetchone()
    return bool(r and r[0])

def _fight(a_uid, b_uid, seed):
    """a is the side that challenged (left), b the one who answered or was called (right)."""
    sa, sb = _save_of(a_uid), _save_of(b_uid)
    if not sa or not sb:
        return None, "nosave"
    if is_flagged(a_uid) or is_flagged(b_uid):
        return None, "review"
    r = engine({"mode": "fight", "a": sa, "b": sb, "seed": seed})
    if not r:
        return None, "engine"
    st = r.pop("stats", [{}, {}])
    r["from"], r["to"] = _card(a_uid, sa, st[0]), _card(b_uid, sb, st[1])
    return r, None

def _duel_pm(uid, txt):
    try:
        tg("sendMessage", chat_id=uid, text=txt,
           reply_markup={"inline_keyboard": [[{"text": "Посмотреть дуэль", "url": app_link("duels")}]]})
    except Exception as e:
        log.info("duel pm to %s: %s", uid, e)

def _tell(uid, txt):
    pm = db.execute("SELECT can_pm FROM players WHERE id=?", (uid,)).fetchone()
    if pm and pm[0]:
        threading.Thread(target=_duel_pm, args=(uid, txt), daemon=True).start()

def _seed(did):
    return int(hashlib.sha256(did.encode()).hexdigest()[:7], 16)   # fits a 32-bit int for the engine

def duel_new(user, body):
    now = time.time()
    if not rate_ok(user["id"], "duel_new", now):
        return SLOW(user["id"], "duel_new")
    with db_lock:
        if is_flagged(user["id"]):
            return 200, {"ok": False, "reason": "review"}
        if not _save_of(user["id"]):
            return 200, {"ok": False, "reason": "nosave"}
        n = db.execute("SELECT COUNT(*) FROM duels WHERE from_uid=? AND to_uid IS NULL AND kind='link' AND created>?",
                       (user["id"], now - DUEL_TTL)).fetchone()[0]
        if n >= DUEL_OPEN_MAX:
            return 200, {"ok": False, "reason": "many", "max": DUEL_OPEN_MAX}
        did = base64.urlsafe_b64encode(os.urandom(6)).decode().replace("-", "x").replace("_", "y")
        db.execute("INSERT INTO duels(id, from_uid, from_snap, created, kind) VALUES(?,?,?,?, 'link')", (did, user["id"], "{}", now))
        db.commit()
    return 200, {"ok": True, "id": did, "link": app_link("duel_" + did)}

def _duel_res(res, fsnap, tsnap):
    """A finished fight; the very first duels kept the heroes' cards apart from the result."""
    try:
        R = json.loads(res)
    except ValueError:
        R = {"win": 0, "log": []}
    for k, raw in (("from", fsnap), ("to", tsnap)):
        if not isinstance(R.get(k), dict):
            try:
                R[k] = json.loads(raw or "{}") or {"name": "Игрок"}
            except ValueError:
                R[k] = {"name": "Игрок"}
    R.setdefault("win", 0)
    return R

def duel_get(user, did):
    did = str(did)[:16]
    uid = user["id"]
    with db_lock:
        r = db.execute("SELECT from_uid, created, to_uid, result, kind, declined FROM duels WHERE id=?", (did,)).fetchone()
        if not r:
            return 404, {"ok": False, "reason": "none"}
        fu, created, tu, res, kind, declined = r
        if res:
            sn = db.execute("SELECT from_snap, to_snap FROM duels WHERE id=?", (did,)).fetchone()
            R = _duel_res(res, sn[0], sn[1])
            side = 0 if fu == uid else 1 if tu == uid else -1
            return 200, {"ok": True, "id": did, "status": "done", "from": R.get("from"), "to": R.get("to"), "result": R, "side": side}
        if declined:
            st = "declined"
        elif created < time.time() - DUEL_TTL:
            st = "expired"
        elif fu == uid:
            st = "mine"
        elif kind == "direct" and tu != uid:
            st = "notyou"          # a personal challenge: only the one who was called can answer it
        else:
            st = "open"
        sv = _save_of(fu)
    stats = engine({"mode": "stats", "saves": [sv]}) if sv else None
    with db_lock:
        card = _card(fu, sv, (stats or {}).get("stats", [{}])[0]) if sv else {"name": "Игрок"}
        db.commit()
    return 200, {"ok": True, "id": did, "status": st, "from": card, "kind": kind}


def _duel_msgs(did):
    with db_lock:
        a = db.execute("SELECT v FROM kv WHERE k=?", ("dmsg:" + did,)).fetchone()
        b = db.execute("SELECT v FROM kv WHERE k=?", ("dpm:" + did,)).fetchone()
    return (json.loads(a[0]) if a else []), (json.loads(b[0]) if b else None)

def _duel_caption(R):
    w, l = (R["from"], R["to"]) if R["win"] == 0 else (R["to"], R["from"])
    cls = {"knight": "Рыцарь", "gunner": "Стрелок", "necro": "Некромант", "assassin": "Ассасин", "gladiator": "Гладиатор"}.get(w.get("cls"), "Герой")
    return f"🏆 Победитель дуэли: {w.get('name', 'Игрок')} ({cls}, {w.get('level', '?')} ур.)\n⚔️ {w.get('name', 'Игрок')} против {l.get('name', 'Игрок')}"

def duel_announce(did, R, photo=None):
    """Turn the invitation in the chat (the card) and in private messages into the result."""
    inl, pm = _duel_msgs(did)
    cap = _duel_caption(R)
    kb = {"inline_keyboard": [[{"text": "👁 Посмотреть бой", "url": app_link("duel_" + did)}]]}
    for imid in inl:
        try:
            if photo:
                tg("editMessageMedia", inline_message_id=imid, media={"type": "photo", "media": photo, "caption": cap}, reply_markup=kb)
            else:
                tg("editMessageCaption", inline_message_id=imid, caption=cap, reply_markup=kb)
        except Exception as e:
            log.info("duel card edit: %s", e)
    if pm and not photo:
        try:
            tg("editMessageText", chat_id=pm[0], message_id=pm[1], text="⚔️ Дуэль окончена!\n" + cap, reply_markup=kb)
        except Exception as e:
            log.info("duel pm edit: %s", e)

def duel_card(user, body):
    """The winner's card drawn by the game replaces the challenge picture in the chat."""
    if not rate_ok(user["id"], "duel_card"):
        return SLOW(user["id"], "duel_card")
    did, image = str(body.get("id", ""))[:16], str(body.get("image", ""))
    with db_lock:
        r = db.execute("SELECT from_uid, to_uid, result FROM duels WHERE id=?", (did,)).fetchone()
    if not r or not r[2] or user["id"] not in (r[0], r[1]) or not image.startswith("data:image/png;base64,"):
        return 200, {"ok": False}
    try:
        from PIL import Image
        raw = base64.b64decode(image.split(",", 1)[1], validate=True)
        if len(raw) > 400_000:
            return 413, {"ok": False}
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im = im.resize((im.width * 3, im.height * 3), Image.NEAREST)
        name = hashlib.sha256(raw).hexdigest()[:24] + ".jpg"
        im.save(os.path.join(CARDS, name), "JPEG", quality=90)
    except Exception as e:
        log.info("bad duel card: %s", e)
        return 400, {"ok": False}
    R = json.loads(r[2])
    if _duel_msgs(did)[0]:
        threading.Thread(target=duel_announce, args=(did, R, WEBAPP_URL + "cards/" + name), daemon=True).start()
    return 200, {"ok": True}

def duel_accept(user, body):
    """The fight happens only here: when the one who was challenged says yes."""
    if not rate_ok(user["id"], "duel_answer"):
        return SLOW(user["id"], "duel_answer")
    did, uid = str(body.get("id", ""))[:16], user["id"]
    with db_lock:
        r = db.execute("SELECT from_uid, created, to_uid, result, kind, declined FROM duels WHERE id=?", (did,)).fetchone()
        if not r:
            return 404, {"ok": False, "reason": "none"}
        fu, created, tu, res, kind, declined = r
        if res or (kind != "direct" and tu):
            return 200, {"ok": False, "reason": "taken"}
        if declined:
            return 200, {"ok": False, "reason": "declined"}
        if fu == uid:
            return 200, {"ok": False, "reason": "self"}
        if kind == "direct" and tu != uid:
            return 200, {"ok": False, "reason": "notyou"}
        if created < time.time() - DUEL_TTL:
            return 200, {"ok": False, "reason": "expired"}
        if kind != "direct":
            db.execute("UPDATE duels SET to_uid=? WHERE id=? AND to_uid IS NULL", (uid, did))   # taken: nobody else can answer
            db.commit()
        R, err = _fight(fu, uid, _seed(did))
        if not R:
            if kind != "direct":
                db.execute("UPDATE duels SET to_uid=NULL WHERE id=?", (did,))
                db.commit()
            return 200, {"ok": False, "reason": err}
        won = R["win"] == 1
        gold = _pay(uid, _player_room(uid), won)
        db.execute("UPDATE duels SET result=?, done_at=? WHERE id=?", (json.dumps(R), time.time(), did))
        db.commit()
        name = R["to"]["name"]
    _tell(fu, f"⚔️ {name} принял твой вызов на дуэль — " + ("ты проиграл. Отомсти!" if won else "ты победил! 🏆")
          + "\nОткрой игру, чтобы посмотреть бой и забрать награду.")
    threading.Thread(target=duel_announce, args=(did, R), daemon=True).start()
    return 200, {"ok": True, "id": did, "from": R["from"], "to": R["to"], "result": R, "side": 1, "reward": {"gold": gold}}

def duel_decline(user, body):
    if not rate_ok(user["id"], "duel_answer"):
        return SLOW(user["id"], "duel_answer")
    did, uid = str(body.get("id", ""))[:16], user["id"]
    with db_lock:
        r = db.execute("SELECT from_uid, to_uid, result, kind FROM duels WHERE id=?", (did,)).fetchone()
        if not r or r[2] or r[3] != "direct" or r[1] != uid:
            return 200, {"ok": False}
        db.execute("UPDATE duels SET declined=1, done_at=? WHERE id=?", (time.time(), did))
        db.commit()
        fu = r[0]
        name = (db.execute("SELECT name FROM players WHERE id=?", (uid,)).fetchone() or ("Игрок",))[0]
    _tell(fu, f"🛡 {name} отказался от дуэли.")
    return 200, {"ok": True}

def duel_direct(user, body):
    """A personal challenge to a player (from the leaderboard or a past duel). Nothing happens until they accept."""
    tag, now, uid = str(body.get("tag", ""))[:16], time.time(), user["id"]
    if not rate_ok(uid, "duel_direct", now):
        return SLOW(uid, "duel_direct")
    with db_lock:
        if is_flagged(user["id"]):
            return 200, {"ok": False, "reason": "review"}
        t = db.execute("SELECT id FROM players WHERE dtag=?", (tag,)).fetchone()
        if not t:
            return 404, {"ok": False, "reason": "none"}
        tid = t[0]
        if tid == uid:
            return 200, {"ok": False, "reason": "self"}
        if not _save_of(uid):
            return 200, {"ok": False, "reason": "nosave_me"}
        n = db.execute("SELECT COUNT(*) FROM duels WHERE from_uid=? AND kind='direct' AND created>=?", (uid, day_id() * 86400)).fetchone()[0]
        if n >= DUEL_DIRECT_PER_DAY:
            return 200, {"ok": False, "reason": "limit", "max": DUEL_DIRECT_PER_DAY}
        if db.execute("""SELECT 1 FROM duels WHERE from_uid=? AND to_uid=? AND kind='direct' AND result IS NULL AND declined=0
                         AND created>?""", (uid, tid, now - DUEL_TTL)).fetchone():
            return 200, {"ok": False, "reason": "pending"}
        did = base64.urlsafe_b64encode(os.urandom(6)).decode().replace("-", "x").replace("_", "y")
        db.execute("INSERT INTO duels(id, from_uid, from_snap, created, to_uid, kind) VALUES(?,?,?,?,?, 'direct')", (did, uid, "{}", now, tid))
        db.commit()
        name = (db.execute("SELECT name FROM players WHERE id=?", (uid,)).fetchone() or ("Игрок",))[0]
        tname = (db.execute("SELECT name FROM players WHERE id=?", (tid,)).fetchone() or ("Игрок",))[0]
        pm = (db.execute("SELECT can_pm FROM players WHERE id=?", (tid,)).fetchone() or (0,))[0]
        if pm and db.execute("SELECT COUNT(*) FROM duels WHERE to_uid=? AND kind='direct' AND created>=?", (tid, now - 86400)).fetchone()[0] > DUEL_PM_PER_DAY:
            pm = 0
    if pm:
        threading.Thread(target=_duel_invite_pm, args=(tid, name, did), daemon=True).start()
    return 200, {"ok": True, "id": did, "to": tname}

def _duel_invite_pm(uid, name, did):
    try:
        r = tg("sendMessage", chat_id=uid, text=f"⚔️ {name} вызывает тебя на дуэль! Примешь вызов?",
               reply_markup={"inline_keyboard": [[{"text": "⚔️ Ответить на вызов", "url": app_link("duel_" + did)}]]})
        with db_lock:
            db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", ("dpm:" + did, json.dumps([uid, r["result"]["message_id"]])))
            db.commit()
    except Exception as e:
        log.info("duel invite pm to %s: %s", uid, e)

def duel_mine(user):
    """Everything about my duels: challenges waiting for me, mine waiting for an answer, and the history."""
    uid, now = user["id"], time.time()
    with db_lock:
        rows = db.execute("""SELECT id, from_uid, to_uid, result, done_at, from_claimed, created, kind, declined, from_snap, to_snap FROM duels
                             WHERE (from_uid=? OR to_uid=?) AND created>? ORDER BY COALESCE(done_at, created) DESC LIMIT 60""",
                          (uid, uid, now - 30 * 86400)).fetchall()
        name = lambda i: (db.execute("SELECT name FROM players WHERE id=?", (i,)).fetchone() or ("Игрок",))[0]
        cls = lambda i: (db.execute("SELECT cls FROM players WHERE id=?", (i,)).fetchone() or ("",))[0]
        gold, fresh, hist, inc, out, opened = 0, [], [], [], [], 0
        for did, fu, tu, res, done, claimed, created, kind, declined, fsnap, tsnap in rows:
            mine = fu == uid
            other = tu if mine else fu
            alive = created > now - DUEL_TTL
            if not res:
                if declined:
                    hist.append({"id": did, "vs": name(other), "cls": cls(other), "state": "declined", "mine": mine, "at": int((done or created) * 1000),
                                 "tag": _tag(other)})
                elif not alive:
                    if kind == "direct":
                        hist.append({"id": did, "vs": name(other), "cls": cls(other), "state": "expired", "mine": mine, "at": int(created * 1000), "tag": _tag(other)})
                elif mine:
                    opened += 1 if kind != "direct" else 0
                    out.append({"id": did, "vs": name(other) if other else None, "kind": kind, "at": int(created * 1000)})
                elif kind == "direct" and tu == uid:
                    inc.append({"id": did, "vs": name(fu), "cls": cls(fu), "at": int(created * 1000)})
                continue
            R = _duel_res(res, fsnap, tsnap)
            won = (R["win"] == 0) == mine
            oc = (R["to"] if mine else R["from"]) or {}
            hist.append({"id": did, "vs": oc.get("name", "Игрок"), "cls": oc.get("cls"), "state": "won" if won else "lost", "won": won,
                         "mine": mine, "at": int(done * 1000), "tag": _tag(other), "kind": kind, "room": R.get("room")})
            if kind == "ghost":
                if not mine and not claimed:    # my ghost fought while I was away
                    g = _ghost_gold(uid, R.get("room") or _player_room(uid), won)
                    gold += g
                    fresh.append({"id": did, "vs": oc.get("name", "Игрок"), "won": won, "gold": g, "ghost": 1})
                    db.execute("UPDATE duels SET from_claimed=1 WHERE id=?", (did,))
                continue
            if mine and not claimed:            # I threw the challenge: my gold comes when I open the game
                g = _pay(uid, _player_room(uid), won)
                gold += g
                fresh.append({"id": did, "vs": oc.get("name", "Игрок"), "won": won, "gold": g})
                db.execute("UPDATE duels SET from_claimed=1 WHERE id=?", (did,))
        db.commit()
    wins = sum(1 for d in hist if d["state"] == "won" and d.get("kind") != "ghost")
    losses = sum(1 for d in hist if d["state"] == "lost" and d.get("kind") != "ghost")
    return 200, {"ok": True, "open": opened, "max": DUEL_OPEN_MAX, "incoming": inc, "outgoing": out, "history": hist[:30],
                 "recent": [h for h in hist if h["state"] in ("won", "lost")][:12], "fresh": fresh, "gold": gold, "wins": wins, "losses": losses}


# ---------------------------------------------------------------- ghosts: players stand on the floor where they stopped
# Climbing the tower you may meet another player on that very floor, dressed and trained as they are now.
# The same player is offered to you at most once a day, wherever either of you goes, so a climbing ghost never follows you up.
db.execute("CREATE TABLE IF NOT EXISTS ghost_offers(uid INTEGER, gid INTEGER, room INTEGER, ts REAL, PRIMARY KEY(uid, gid))")
db.commit()
GHOST_GAP = 86400            # one meeting with the same player a day
GHOST_PAID_PER_DAY = 10      # the ghost's owner is paid for at most this many fights a day

def ghost_find(user, room):
    uid, now, room = user["id"], time.time(), as_int(room, 1, 10**6)
    with db_lock:
        rows = db.execute("""SELECT p.id FROM players p JOIN saves s ON s.uid=p.id
                             WHERE p.room+1=? AND p.id<>? AND p.flagged=0 AND p.id NOT IN
                               (SELECT gid FROM ghost_offers WHERE uid=? AND ts>? AND room<>?)""",
                          (room, uid, uid, now - GHOST_GAP, room)).fetchall()
        if not rows:
            return 200, {"ok": True, "ghost": None}
        import random
        gid = random.choice(rows)[0]
        sv = _save_of(gid)
        if not sv:
            return 200, {"ok": True, "ghost": None}
        db.execute("INSERT OR REPLACE INTO ghost_offers(uid, gid, room, ts) VALUES(?,?,?,?)", (uid, gid, room, now))
        db.commit()
    st = engine({"mode": "stats", "saves": [sv]})
    with db_lock:
        card = _card(gid, sv, (st or {}).get("stats", [{}])[0])
        db.commit()
    return 200, {"ok": True, "ghost": card}

def _ghost_gold(uid, room, won):
    day = -day_id()          # its own daily counter, apart from duels
    n = (db.execute("SELECT n FROM duel_paid WHERE uid=? AND day=?", (uid, day)).fetchone() or (0,))[0]
    if n >= GHOST_PAID_PER_DAY:
        return 0
    db.execute("INSERT OR REPLACE INTO duel_paid(uid, day, n) VALUES(?,?,?)", (uid, day, n + 1))
    room = max(1, room)
    return int((30 + room * 3) if won else (10 + room))

def ghost_fight(user, body):
    if not rate_ok(user["id"], "ghost"):
        return SLOW(user["id"], "ghost")
    uid, tag, now = user["id"], str(body.get("tag", ""))[:16], time.time()
    with db_lock:
        t = db.execute("SELECT id FROM players WHERE dtag=?", (tag,)).fetchone()
        if not t:
            return 200, {"ok": False, "reason": "none"}
        gid = t[0]
        off = db.execute("SELECT room, ts FROM ghost_offers WHERE uid=? AND gid=?", (uid, gid)).fetchone()
        if not off or now - off[1] > 2 * 3600:
            return 200, {"ok": False, "reason": "expired"}
        if db.execute("SELECT 1 FROM duels WHERE kind='ghost' AND from_uid=? AND to_uid=? AND created>?", (uid, gid, off[1] - 1)).fetchone():
            return 200, {"ok": False, "reason": "taken"}          # one fight per meeting
        did = base64.urlsafe_b64encode(os.urandom(6)).decode().replace("-", "x").replace("_", "y")
        R, err = _fight(uid, gid, _seed(did))
        if not R:
            return 200, {"ok": False, "reason": err}
        R["room"] = off[0]
        db.execute("""INSERT INTO duels(id, from_uid, from_snap, created, to_uid, to_snap, result, done_at, kind)
                      VALUES(?,?,?,?,?,?,?,?, 'ghost')""", (did, uid, "{}", now, gid, "{}", json.dumps(R), now))
        db.commit()
        me = R["from"]["name"]
    ghost_won = R["win"] == 1
    _tell(gid, f"👻 {me} встретил твоего призрака на {off[0]} этаже — " + ("призрак победил! 🏆" if ghost_won else "и одолел его.")
          + "\nЗагляни в игру: за бой призрака тебе положено немного золота.")
    return 200, {"ok": True, "id": did, "from": R["from"], "to": R["to"], "result": R, "side": 0, "room": off[0]}

# ---------------------------------------------------------------- stars: bought by the player, never earned in the game
# The balance lives only here, so it can't be edited on the phone. Every change is written to star_ledger.
# Stars are bought with real Telegram Stars (1 ★ in the game = 1 Telegram Star): the game asks for an invoice link
# (createInvoiceLink, currency XTR), Telegram takes the payment, the bot answers the pre-checkout and its successful_payment
# adds the stars (once per telegram_payment_charge_id). STARS_TEST=1 brings back the free test button for everyone;
# the owners always have it (the «+50 звёзд» debug button) to test without paying.
STARS_TEST = os.environ.get("STARS_TEST", "0") == "1"   # only the default: the owners switch it in the game (kv stars_test)

def _stars_test():
    r = db.execute("SELECT v FROM kv WHERE k='stars_test'").fetchone()
    return STARS_TEST if r is None else r[0] == "1"

def stars_mode(user, body):
    """Owners: {test: true} — buying is free for everyone (testers); {test: false} — real Telegram Stars."""
    if user["id"] not in ADMIN_IDS:
        return 403, {"ok": False}
    with db_lock:
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES('stars_test', ?)", ("1" if body.get("test") else "0",))
        db.commit()
        st = _stars_state(user["id"])
    log.info("stars mode by %s: %s", user["id"], "test" if st["test"] else "real")
    return 200, dict(st, ok=True)
STAR_INVOICE_MAX = 2500
STAR_PACKS = (10, 25, 50, 100, 250, 500)
PRICE = {"reset": 5, "path": 10, "class": 25, "luck": 1}      # rest skips cost 1 star each, 1..100 at a time; autofarm runs on skips, not sold
_pc = {r[1] for r in db.execute("PRAGMA table_info(players)")}
for col, decl in [("stars", "INTEGER DEFAULT 0"), ("skips", "INTEGER DEFAULT 0"), ("class_changes", "INTEGER DEFAULT 0"), ("autofarm", "INTEGER DEFAULT 0")]:
    if col not in _pc:
        db.execute(f"ALTER TABLE players ADD COLUMN {col} {decl}")
db.execute("""CREATE TABLE IF NOT EXISTS star_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER, delta INTEGER,
  what TEXT, n INTEGER, ts REAL)""")
db.execute("""CREATE TABLE IF NOT EXISTS star_pay(charge TEXT PRIMARY KEY, uid INTEGER, n INTEGER, payload TEXT, ts REAL,
  refunded INTEGER DEFAULT 0)""")
db.commit()

def _stars_state(uid):
    r = db.execute("SELECT stars, skips, class_changes, autofarm FROM players WHERE id=?", (uid,)).fetchone() or (0, 0, 0, 0)
    return {"balance": r[0] or 0, "skips": r[1] or 0, "class_free": (r[2] or 0) == 0, "autofarm": bool(r[3]), "prices": PRICE,
            "packs": list(STAR_PACKS), "test": _stars_test(), "free_reset": _free_reset(uid)}

def _free_reset(uid):
    r = db.execute("SELECT v FROM kv WHERE k=?", (f"rstfree:{uid}",)).fetchone()
    fr = json.loads(r[0]) if r else None
    return fr if fr and fr.get("until", 0) > time.time() else None

def stars_get(user):
    with db_lock:
        return 200, _stars_state(user["id"])

def stars_topup(user, body):
    """TEST STUB: adds a pack without payment. Off in release (STARS_TEST=0), where only a paid invoice adds stars."""
    n = as_int(body.get("n"), 0, 100000)
    with db_lock:
        test = _stars_test()
    if not test and user["id"] not in ADMIN_IDS:
        return 403, {"ok": False, "reason": "payments"}
    if n not in STAR_PACKS:
        return 400, {"ok": False, "reason": "pack"}
    with db_lock:
        db.execute("UPDATE players SET stars=stars+? WHERE id=?", (n, user["id"]))
        db.execute("INSERT INTO star_ledger(uid, delta, what, n, ts) VALUES(?,?,?,?,?)", (user["id"], n, "topup-test", n, time.time()))
        db.commit()
        st = _stars_state(user["id"])
    log.info("stars test top-up %s +%s", user["id"], n)
    return 200, dict(st, ok=True)

def stars_invoice(user, body):
    """{n}: a Telegram Stars invoice link for n stars (a pack, or exactly what a purchase is short of)."""
    n = as_int(body.get("n"), 0, STAR_INVOICE_MAX)
    if n < 1:
        return 400, {"ok": False, "reason": "pack"}
    payload = f"st:{user['id']}:{n}:{int(time.time())}"
    try:
        r = tg("createInvoiceLink", title=f"{n} звёзд для еБашни",
               description="Звёзды на счёт героя: пропуски отдыха и автофарм, удача, сброс навыков и пути.",
               payload=payload, provider_token="", currency="XTR", prices=[{"label": f"{n} звёзд", "amount": n}])
    except Exception as e:
        log.warning("createInvoiceLink: %s", e)
        return 200, {"ok": False, "reason": "tg"}
    if not r.get("ok"):
        log.warning("createInvoiceLink: %s", r)
        return 200, {"ok": False, "reason": "tg"}
    return 200, {"ok": True, "link": r["result"], "n": n}

def _star_payload(p):
    try:
        k, uid, n, _ = str(p).split(":")
        return (int(uid), int(n)) if k == "st" else None
    except Exception:
        return None

def stars_precheckout(q):
    """Telegram asks right before taking the money: the invoice must be ours and for this player. Answered within 10 s."""
    pl, fr = _star_payload(q.get("invoice_payload")), (q.get("from") or {}).get("id")
    ok = bool(pl) and pl[0] == fr and pl[1] == q.get("total_amount") and q.get("currency") == "XTR"
    if ok:
        with db_lock:
            ok = db.execute("SELECT 1 FROM players WHERE id=?", (fr,)).fetchone() is not None
    tg("answerPreCheckoutQuery", pre_checkout_query_id=q["id"], ok=ok,
       **({} if ok else {"error_message": "Не получилось оформить покупку. Открой игру заново и попробуй ещё раз."}))

def stars_paid(msg):
    """The money is taken: the stars go on the player's account, once per charge id."""
    sp, fr = msg["successful_payment"], (msg.get("from") or {}).get("id")
    pl, charge = _star_payload(sp.get("invoice_payload")), sp.get("telegram_payment_charge_id")
    n = int(sp.get("total_amount") or 0)
    if not pl or not charge or sp.get("currency") != "XTR":
        log.warning("strange payment %s from %s", sp, fr)
        return
    uid = pl[0]
    with db_lock:
        if db.execute("SELECT 1 FROM star_pay WHERE charge=?", (charge,)).fetchone():
            return
        db.execute("INSERT INTO star_pay(charge, uid, n, payload, ts) VALUES(?,?,?,?,?)", (charge, uid, n, sp.get("invoice_payload"), time.time()))
        db.execute("UPDATE players SET stars=stars+? WHERE id=?", (n, uid))
        db.execute("INSERT INTO star_ledger(uid, delta, what, n, ts) VALUES(?,?,?,?,?)", (uid, n, "topup", n, time.time()))
        db.commit()
    log.info("stars paid: %s +%s (%s)", uid, n, charge)
    try:
        tg("sendMessage", chat_id=msg["chat"]["id"], text=f"Оплата прошла: +{n} ★ на счёт героя. Возвращайся в башню!",
           reply_markup={"inline_keyboard": [[{"text": "Войти в башню", "web_app": {"url": WEBAPP_URL}}]]})
    except Exception as e:
        log.info("paid note: %s", e)

def refund_command(msg):
    """Owners: /refund <charge id> — gives the Telegram Stars back and takes the stars off the account (it may go below 0)."""
    if (msg.get("from") or {}).get("id") not in ADMIN_IDS:
        return
    parts, chat = (msg.get("text") or "").split(), msg["chat"]["id"]
    if len(parts) < 2:
        with db_lock:
            rows = db.execute("SELECT charge, uid, n, ts, refunded FROM star_pay ORDER BY ts DESC LIMIT 50").fetchall()
        lines = [f"{time.strftime('%d.%m %H:%M', time.localtime(r[3]))} · id {r[1]} · {r[2]} ★{' · возврат' if r[4] else ''}\n{r[0]}" for r in rows]
        # a Telegram message holds 4096 characters: 50 purchases go out in several messages
        parts, cur = [], "Последние покупки звёзд (до 50):"
        for ln in lines or ["пока нет"]:
            if len(cur) + len(ln) + 2 > 3800:
                parts.append(cur)
                cur = ""
            cur += "\n\n" + ln
        parts.append(cur + "\n\nВернуть: /refund <id платежа>")
        for t in parts:
            tg("sendMessage", chat_id=chat, text=t.strip())
        return
    charge = parts[1]
    with db_lock:
        r = db.execute("SELECT uid, n, refunded FROM star_pay WHERE charge=?", (charge,)).fetchone()
    if not r:
        tg("sendMessage", chat_id=chat, text="Такого платежа нет.")
        return
    if r[2]:
        tg("sendMessage", chat_id=chat, text="Этот платёж уже возвращён.")
        return
    res = tg("refundStarPayment", user_id=r[0], telegram_payment_charge_id=charge)
    if not res.get("ok"):
        tg("sendMessage", chat_id=chat, text=f"Telegram не вернул: {res.get('description')}")
        return
    with db_lock:
        db.execute("UPDATE star_pay SET refunded=1 WHERE charge=?", (charge,))
        db.execute("UPDATE players SET stars=stars-? WHERE id=?", (r[1], r[0]))
        db.execute("INSERT INTO star_ledger(uid, delta, what, n, ts) VALUES(?,?,?,?,?)", (r[0], -r[1], "refund", r[1], time.time()))
        db.commit()
    tg("sendMessage", chat_id=chat, text=f"Вернул {r[1]} ★ игроку {r[0]}.")

def stars_buy(user, body):
    """{item: skips (n 1..100) | reset | path | class | luck}. Takes the stars and gives the right; the game applies it."""
    item, uid = str(body.get("item", "")), user["id"]
    with db_lock:
        r = db.execute("SELECT stars, skips, class_changes FROM players WHERE id=?", (uid,)).fetchone() or (0, 0, 0)
        bal = r[0] or 0
        n = 1
        if item == "skips":
            n = as_int(body.get("n"), 1, 100)
            cost = n
        elif item == "class":
            cost = 0 if (r[2] or 0) == 0 else PRICE["class"]
        elif item == "reset":
            # «Умения» and «Мастерство» are reset apart; after a paid one the other is free for a day, once
            kind = "mastery" if body.get("kind") == "mastery" else "skills"
            k = f"rstfree:{uid}"
            fr = db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
            fr = json.loads(fr[0]) if fr else None
            if fr and fr.get("kind") == kind and fr.get("until", 0) > time.time():
                cost = 0
                db.execute("DELETE FROM kv WHERE k=?", (k,))
            else:
                cost = PRICE["reset"]
                if bal >= cost:
                    db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)",
                               (k, json.dumps({"kind": "skills" if kind == "mastery" else "mastery", "until": time.time() + 86400})))
        elif item in PRICE:
            cost = PRICE[item]
        else:
            return 400, {"ok": False, "reason": "item"}
        if bal < cost:
            return 200, dict(_stars_state(uid), ok=False, reason="balance", need=cost)
        db.execute("UPDATE players SET stars=stars-? WHERE id=?", (cost, uid))
        if item == "skips":
            db.execute("UPDATE players SET skips=skips+? WHERE id=?", (n, uid))
        if item == "class":
            db.execute("UPDATE players SET class_changes=class_changes+1 WHERE id=?", (uid,))
        db.execute("INSERT INTO star_ledger(uid, delta, what, n, ts) VALUES(?,?,?,?,?)", (uid, -cost, item, n, time.time()))
        db.commit()
        st = _stars_state(uid)
    return 200, dict(st, ok=True, item=item, n=n, cost=cost)

# ---------------------------------------------------------------- «Удача»: the shop's slot machine for stars
# The server rolls and pays: stars go out, rest skips come in here; gold, cores and items are written into the save by the
# game from the answer. Prizes are only things of the game. 2★ a spin, ×10 for 20★, no daily limit.
LUCK_TABLE = [("jack", 1), ("stars", 4), ("cherry", 5), ("bag", 5), ("pair", 45), ("none", 40)]
LUCK_SYMS = ["cherry", "bag", "star", "seven", "blade", "shield", "card", "dice"]
LUCK_LIMIT = 10**9   # no daily limit any more (kept as a number for old games that still show «left»)
_lrng = random.SystemRandom()

def _luck_one():
    x, k = _lrng.random() * 100, "none"
    for kk, w in LUCK_TABLE:
        x -= w
        if x <= 0:
            k = kk
            break
    def other(ex):
        while True:
            s = _lrng.choice(LUCK_SYMS)
            if s not in ex:
                return s
    if k == "jack":
        syms, prize = ["seven"] * 3, {"item": 4, "skips": 10}
    elif k == "stars":
        syms, prize = ["star"] * 3, {"item": 3}
    elif k == "cherry":
        syms, prize = ["cherry"] * 3, {"skips": 3}
    elif k == "bag":
        syms, prize = ["bag"] * 3, {"cores": 5}
    elif k == "pair":
        a = other([]); b = other([a]); syms = [a, a, a]; syms[_lrng.randrange(3)] = b
        prize = {"gold": 5} if _lrng.random() < 0.5 else {"cores": 1}
    else:
        a = other([]); b = other([a]); c = other([a, b]); syms = [a, b, c]; prize = {"gold": 1}
    return {"k": k, "syms": syms, "prize": prize}

def luck_spin(user, body):
    n = 10 if as_int(body.get("n"), 1, 10) >= 10 else 1
    cost, uid, day = (20 if n == 10 else 2), user["id"], day_id()
    with db_lock:
        bal = (db.execute("SELECT stars FROM players WHERE id=?", (uid,)).fetchone() or (0,))[0] or 0
        k = f"luck:{uid}:{day}"
        used = as_int((db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone() or ("0",))[0])
        if used + n > LUCK_LIMIT:
            return 200, dict(_stars_state(uid), ok=False, reason="limit", left=LUCK_LIMIT - used)
        if bal < cost:
            return 200, dict(_stars_state(uid), ok=False, reason="balance", need=cost, left=LUCK_LIMIT - used)
        res = [_luck_one() for _ in range(n)]
        skips = sum(r["prize"].get("skips", 0) for r in res)
        db.execute("UPDATE players SET stars=stars-?, skips=skips+? WHERE id=?", (cost, skips, uid))
        db.execute("INSERT INTO star_ledger(uid, delta, what, n, ts) VALUES(?,?,?,?,?)", (uid, -cost, "luck", n, time.time()))
        if skips:
            db.execute("INSERT INTO star_ledger(uid, delta, what, n, ts) VALUES(?,?,?,?,?)", (uid, 0, "luck-skips", skips, time.time()))
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (k, str(used + n)))
        db.commit()
        st = _stars_state(uid)
    if any(r["k"] == "jack" for r in res):
        log.info("luck jackpot for %s", uid)
    return 200, dict(st, ok=True, results=res, cost=cost, left=LUCK_LIMIT - used - n)

def luck_info(user):
    with db_lock:
        used = as_int((db.execute("SELECT v FROM kv WHERE k=?", (f"luck:{user['id']}:{day_id()}",)).fetchone() or ("0",))[0])
    return 200, {"left": LUCK_LIMIT - used, "limit": LUCK_LIMIT}

def stars_skip(user):
    """One bought rest skip is used: the hero may fight right now."""
    with db_lock:
        cur = db.execute("UPDATE players SET skips=skips-1 WHERE id=? AND skips>0", (user["id"],))
        ok = cur.rowcount == 1
        if ok:
            db.execute("INSERT INTO star_ledger(uid, delta, what, n, ts) VALUES(?,?,?,?,?)", (user["id"], 0, "skip-used", 1, time.time()))
        db.commit()
        st = _stars_state(user["id"])
    return 200, dict(st, ok=ok)

# ---------------------------------------------------------------- quests: the «Задания» tab
# Daily ones reset at midnight in AC_TZ (Moscow by default), achievements are once per player.
# Progress is counted here from what the server already knows, so a claim can't be faked from the phone.
# Rewards scale with the player's floor: G is about ten fights of gold, X about five fights of experience.
db.execute("CREATE TABLE IF NOT EXISTS quest_claims(uid INTEGER, qid TEXT, period INTEGER, ts REAL, PRIMARY KEY(uid, qid, period))")
db.commit()
QUESTS = [
    # id, daily, title, goal, reward {skips, G, X, cores}
    ("d_login",   1, "Зайти в игру",                    1,   {"skips": 1, "G": 1, "X": 1}),
    ("d_win10",   1, "Пройти 10 комнат за сегодня",     10,  {"skips": 1, "G": 2, "X": 1}),
    ("d_win30",   1, "Пройти 30 комнат за сегодня",     30,  {"skips": 2, "G": 4, "X": 2}),
    ("d_duel",    1, "Сыграть дуэль",                   1,   {"G": 2, "X": 1, "cores": 1}),
    ("d_elite5",  1, "Пройти 5 элитных этажей",         5,   {"skips": 1, "G": 3, "X": 2, "cores": 1}),
    ("d_boss2",   1, "Убить 2 боссов",                  2,   {"skips": 2, "G": 5, "X": 4, "cores": 2}),
    ("d_share",   1, "Позвать друга: кто-то зашёл по твоей ссылке", 1, {"skips": 1, "G": 2, "X": 1, "cores": 1}),
    ("a_invite1", 0, "Пригласить друга",                1,   {"skips": 3, "G": 5, "X": 2}),
    ("a_invite3", 0, "Пригласить трёх друзей",          3,   {"skips": 10, "G": 10, "X": 5, "cores": 3}),
    ("a_skip1",   0, "Купить пропуск отдыха",           1,   {"skips": 3, "G": 5, "X": 2, "cores": 1}),
    ("a_skip10",  0, "Купить 10 пропусков отдыха",      10,  {"skips": 5, "G": 10, "X": 3, "cores": 2}),
    ("a_skip100", 0, "Купить 100 пропусков отдыха",     100, {"skips": 20, "G": 30, "X": 10, "cores": 5}),
    ("a_duel10",  0, "Выиграть 10 дуэлей",              10,  {"skips": 5, "G": 10, "X": 5, "cores": 3}),
    ("a_channel", 0, "Подписаться на канал eBashnya (@yourebashnya)", 1,   {"skips": 3, "G": 5, "X": 2, "cores": 1}),
]
QMAP = {q[0]: q for q in QUESTS}

def q_day(now=None):
    return int(((now or time.time()) + AC_TZ * 3600) // 86400)

def q_day_start(d):
    return d * 86400 - AC_TZ * 3600

def _qbase_f(uid, field):
    """Like _qbase, for another counter of the save (st.ekills, st.bkills). Caller holds db_lock."""
    k = f"qb:{uid}:{q_day()}:{field}"
    r = db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    if r:
        return as_int(r[0], -10**9)
    sv = _save_of(uid)
    if not sv:
        return None
    v = as_int((sv.get("st") or {}).get(field), 0, 10**9)
    db.execute("INSERT OR IGNORE INTO kv(k, v) VALUES(?,?)", (k, str(v)))
    return v

def _qbase(uid):
    """Won fights at the start of today (from the save): the daily «rooms» quests count from here. Caller holds db_lock."""
    k = f"qb:{uid}:{q_day()}"
    r = db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    if r:
        return as_int(r[0], -10**9)
    sv = _save_of(uid)
    if not sv:
        return None             # no save yet: the first one that arrives becomes the starting point
    w = as_int((sv.get("st") or {}).get("wins"), 0, 10**9)
    db.execute("INSERT OR IGNORE INTO kv(k, v) VALUES(?,?)", (k, str(w)))
    return w

def _q_reward(uid, rw):
    room = max(1, (db.execute("SELECT room FROM players WHERE id=?", (uid,)).fetchone() or (1,))[0] or 1)
    G = round((8 + room * 3.2) * 10)
    X = round((18 + room * 7 + room * room * 0.05) * 1)  # v191: one ordinary fight per unit (was 5)
    return {"skips": rw.get("skips", 0), "gold": G * rw.get("G", 0), "xp": X * rw.get("X", 0), "cores": rw.get("cores", 0)}

def _q_progress(uid):
    day = q_day()
    t0 = q_day_start(day)
    sv = _save_of(uid) or {}
    wins_now = as_int((sv.get("st") or {}).get("wins"), 0, 10**9)
    base = _qbase(uid)
    won_today = 0 if base is None else max(0, wins_now - base)
    duels_today = db.execute("""SELECT COUNT(*) FROM duels WHERE result IS NOT NULL AND done_at>=?
                                AND (from_uid=? OR to_uid=?)""", (t0, uid, uid)).fetchone()[0]
    invites = db.execute("SELECT COUNT(*) FROM players WHERE ref_by=?", (uid,)).fetchone()[0]
    bought = db.execute("SELECT COALESCE(SUM(n),0) FROM star_ledger WHERE uid=? AND what='skips'", (uid,)).fetchone()[0]
    dw = 0
    for fu, res in db.execute("SELECT from_uid, result FROM duels WHERE result IS NOT NULL AND (from_uid=? OR to_uid=?)", (uid, uid)):
        try:
            win = json.loads(res).get("win")
        except (ValueError, AttributeError):
            continue
        if (fu == uid and win == 0) or (fu != uid and win == 1):
            dw += 1
    def today(field):
        b = _qbase_f(uid, field)
        return 0 if b is None else max(0, as_int((sv.get("st") or {}).get(field), 0, 10**9) - b)
    hits = db.execute("SELECT COUNT(*) FROM ref_hits WHERE inviter=? AND day=?", (uid, day)).fetchone()[0]
    chan = 1 if db.execute("SELECT 1 FROM kv WHERE k=?", (f"chan:{uid}",)).fetchone() else 0
    return {"d_login": 1, "d_win10": won_today, "d_win30": won_today, "d_duel": duels_today,
            "d_elite5": today("ekills"), "d_boss2": today("bkills"), "d_share": hits, "a_channel": chan,
            "a_invite1": invites, "a_invite3": invites, "a_skip1": bought, "a_skip10": bought, "a_skip100": bought, "a_duel10": dw}

def _q_list(uid):
    day = q_day()
    prog = _q_progress(uid)
    claimed = {(q, p) for q, p in db.execute("SELECT qid, period FROM quest_claims WHERE uid=? AND (period=? OR period=0)", (uid, day))}
    out = []
    for qid, daily, title, goal, rw in QUESTS:
        per = day if daily else 0
        n = prog.get(qid, 0)
        out.append({"id": qid, "daily": daily, "title": title, "goal": goal, "n": min(n, goal), "done": n >= goal,
                    "claimed": (qid, per) in claimed, "reward": _q_reward(uid, rw)})
    return {"quests": out, "resetAt": int(q_day_start(day + 1) * 1000), "wbase": _qbase(uid), "ebase": _qbase_f(uid, "ekills"), "bbase": _qbase_f(uid, "bkills")}

def quests_get(user):
    with db_lock:
        v = _q_list(user["id"])
        db.commit()
    return 200, v

CHANNEL = os.environ.get("CHANNEL", "@yourebashnya")

def quest_channel(user):
    """«Подписаться на канал»: the bot asks Telegram whether the player is in the channel.
    If the bot can't see the channel's members (it is not an admin there), the tap on the link is enough."""
    uid, ok, why = user["id"], False, ""
    try:
        r = tg("getChatMember", chat_id=CHANNEL, user_id=uid)
        ok = (r.get("result") or {}).get("status") in ("member", "administrator", "creator", "restricted")
        why = "not member" if not ok else ""
    except Exception as e:
        log.info("channel check for %s: %s", uid, e)
        ok, why = True, "unchecked"
    if ok:
        with db_lock:
            db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (f"chan:{uid}", "1"))
            db.commit()
    return 200, {"ok": ok, "reason": why}

def quests_claim(user, body):
    qid = str(body.get("id", ""))
    q = QMAP.get(qid)
    if not q:
        return 400, {"ok": False, "reason": "quest"}
    uid = user["id"]
    with db_lock:
        prog = _q_progress(uid)
        if prog.get(qid, 0) < q[3]:
            db.commit()
            return 200, {"ok": False, "reason": "not done"}
        per = q_day() if q[1] else 0
        cur = db.execute("INSERT OR IGNORE INTO quest_claims(uid, qid, period, ts) VALUES(?,?,?,?)", (uid, qid, per, time.time()))
        if cur.rowcount != 1:
            db.commit()
            return 200, {"ok": False, "reason": "claimed"}
        rw = _q_reward(uid, q[4])
        if rw["skips"]:
            db.execute("UPDATE players SET skips=skips+? WHERE id=?", (rw["skips"], uid))
            db.execute("INSERT INTO star_ledger(uid, delta, what, n, ts) VALUES(?,?,?,?,?)", (uid, 0, "quest-skips:" + qid, rw["skips"], time.time()))
        db.commit()
        v = _q_list(uid)
        st = _stars_state(uid)
        db.commit()
    return 200, dict(v, ok=True, id=qid, reward=rw, stars=st)


# ---------------------------------------------------------------- GROUP BOSS: 2–4 heroes against one boss, gathered by a link
# Boss levels 5, 10, 15, 20, then every 15 (must match the game). A hero may fight a boss from 2 levels below to 5 above it
# (from the 20th boss on: 5 below, 9 above); the boss is as strong as the group's average level within that range.
# Each boss level pays once a day per player (a lost fight does not use it up). The fight is computed here by the game's engine;
# everyone sees the same replay, and the reward waits on the server until the player picks it up.
GR_MAX, GR_TTL = 4, 2 * 3600
db.execute("""CREATE TABLE IF NOT EXISTS gr_lobby(id TEXT PRIMARY KEY, b INTEGER, host INTEGER, members TEXT, created REAL,
  status TEXT DEFAULT 'open', result TEXT, done_at REAL)""")
db.execute("""CREATE TABLE IF NOT EXISTS gr_claims(uid INTEGER, b INTEGER, day INTEGER, lobby TEXT, reward TEXT, claimed INTEGER DEFAULT 0,
  PRIMARY KEY(uid, b, day))""")
db.execute("CREATE INDEX IF NOT EXISTS gr_lobby_host ON gr_lobby(host, created)")
try:
    db.execute("ALTER TABLE gr_lobby ADD COLUMN public INTEGER DEFAULT 0")   # an open group anyone of a fitting level can find
except sqlite3.OperationalError:
    pass
db.commit()

def gr_levels(up_to):
    a = [5, 10, 15]
    b = 20
    while b <= up_to:
        a.append(b)
        b += 15
    return [x for x in a if x <= up_to]

def gr_lo(b):
    return 2 if b <= 15 else 5

def gr_hi(b):
    return 5 if b <= 15 else 9

def gr_win(b):
    return gr_hi(b)

def gr_for(lv):
    """From 2 levels below the boss to 5 above (from the 20th boss: 5 below, 9 above). Must match the game."""
    return [b for b in gr_levels(lv + 10) if b - gr_lo(b) <= lv <= b + gr_hi(b)]

# ---- telling players of a fitting level about an open group (v194)
GR_NAMES = ["Король Скелетов", "Королева пауков", "Огненный повелитель", "Минотавр", "Лич", "Король Пепла", "Призрак Принцессы",
            "Повелитель бездны", "Идейный", "Андре Охевич", "Павол Дерув"]          # the game's GR_TYPES order
GR_NOTE_MAX = 40             # players told about one group
GR_NOTE_GAP = 1800           # one player hears about a group at most once in 30 minutes…
GR_NOTE_DAY = 5              # …and five times a day
def gr_boss_name(b):
    return GR_NAMES[(len(gr_levels(b)) - 1) % len(GR_NAMES)]

def _gr_pick_note(L):
    """Who to tell (called under db_lock): fitting level, wrote to the bot, seen in the last week, not muted, not over the limits."""
    now, b = time.time(), L["b"]
    lo, hi = b - gr_lo(b), b + gr_hi(b)
    today = q_day()
    out = []
    rows = db.execute("""SELECT id FROM players WHERE can_pm=1 AND flagged=0 AND level BETWEEN ? AND ? AND seen>?
                         ORDER BY seen DESC LIMIT 400""", (lo, hi, now - 7 * 86400)).fetchall()
    for (pid,) in rows:
        if len(out) >= GR_NOTE_MAX:
            break
        if pid in L["members"] or db.execute("SELECT 1 FROM kv WHERE k=?", (f"grmute:{pid}",)).fetchone():
            continue
        c = db.execute("SELECT v FROM kv WHERE k=?", (f"grnc:{pid}",)).fetchone()
        c = json.loads(c[0]) if c else {"t": 0, "d": 0, "n": 0}
        if now - c.get("t", 0) < GR_NOTE_GAP or (c.get("d") == today and c.get("n", 0) >= GR_NOTE_DAY):
            continue
        lv, sv = _gr_level(pid)
        if not sv or b not in gr_for(lv) or _gr_won_today(pid, b):
            continue
        n = c.get("n", 0) + 1 if c.get("d") == today else 1
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (f"grnc:{pid}", json.dumps({"t": now, "d": today, "n": n})))
        out.append(pid)
    return out

def _gr_send_note(gid, b, host_name, free, who):
    text = (f"👥 {host_name} собирает группу на босса «{gr_boss_name(b)}» ({b} ур.).\n"
            f"Свободно мест: {free} из {GR_MAX}. Награда — по вкладу в урон.")
    kb = {"inline_keyboard": [[{"text": "⚔️ Вступить в группу", "url": app_link("gr_" + gid)}],
                              [{"text": "🔕 Не присылать о группах", "callback_data": "grm:off"}]]}
    sent = []
    for pid in who:
        r = tg_try("sendMessage", chat_id=pid, text=text, reply_markup=kb)
        if r and r.get("ok"):
            sent.append([pid, r["result"]["message_id"]])
        elif r and r.get("error_code") == 403:  # blocked the bot: stop writing to him
            with db_lock:
                db.execute("UPDATE players SET can_pm=0 WHERE id=?", (pid,))
                db.commit()
        time.sleep(0.05)                       # Telegram allows about 30 messages a second
    with db_lock:
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (f"grmsg:{gid}", json.dumps(sent)))
        db.commit()

def gr_note_done(gid, why):
    """The group went into battle or closed: the invitations lose their button."""
    with db_lock:
        r = db.execute("SELECT v FROM kv WHERE k=?", (f"grmsg:{gid}",)).fetchone()
        if not r:
            return
        db.execute("DELETE FROM kv WHERE k=?", (f"grmsg:{gid}",))
        db.commit()
    for pid, mid in json.loads(r[0]):
        tg_try("editMessageText", chat_id=pid, message_id=mid, text=why)
        time.sleep(0.05)

def gr_mute_callback(cq):
    uid, on = cq["from"]["id"], (cq.get("data") or "") == "grm:on"
    with db_lock:
        if on:
            db.execute("DELETE FROM kv WHERE k=?", (f"grmute:{uid}",))
        else:
            db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (f"grmute:{uid}", "1"))
        db.commit()
    tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Снова буду звать в группы" if on else "Больше не буду звать в группы")
    m = cq.get("message") or {}
    if m:
        btn = {"text": "🔔 Звать в группы снова", "callback_data": "grm:on"} if not on else {"text": "🔕 Не присылать о группах", "callback_data": "grm:off"}
        rows = [r for r in ((m.get("reply_markup") or {}).get("inline_keyboard") or []) if not any(str(x.get("callback_data", "")).startswith("grm:") for x in r)]
        tg_try("editMessageReplyMarkup", chat_id=m["chat"]["id"], message_id=m["message_id"], reply_markup={"inline_keyboard": rows + [[btn]]})

GR_BOT = 10**12
def _gr_save_of(m, host=None):
    """A test bot (admins only) has a negative id: -uid fights as a copy of that player's hero, below -GR_BOT as the host's."""
    if m >= 0:
        return _save_of(m)
    return _save_of(host) if -m >= GR_BOT else _save_of(-m)

def _gr_level(uid):
    sv = _save_of(uid)
    return (as_int(sv.get("level"), 1, 100000) if sv else 0), sv

def _gr_won_today(uid, b):
    return db.execute("SELECT 1 FROM gr_claims WHERE uid=? AND b=? AND day=?", (uid, b, day_id())).fetchone() is not None

def _gr_row(gid):
    r = db.execute("SELECT id, b, host, members, created, status, result, done_at, public FROM gr_lobby WHERE id=?", (gid,)).fetchone()
    if not r:
        return None
    try:
        mem = json.loads(r[3] or "[]")
    except ValueError:
        mem = []
    return {"id": r[0], "b": r[1], "host": r[2], "members": mem, "created": r[4], "status": r[5], "result": r[6], "done_at": r[7], "public": r[8] or 0}

def _gr_view(L, uid, full=False):
    cards = []
    for m in L["members"]:
        sv = _gr_save_of(m, L["host"])
        src = m if m >= 0 else (L["host"] if -m >= GR_BOT else -m)
        c = _card(src, sv) if sv else {"name": "Игрок", "cls": "knight", "level": 1, "look": {"cls": "knight"}}
        if m < 0:
            c["name"] = "Бот · " + str(c.get("name", "Игрок"))
            c["bot"] = 1
            c.pop("tag", None)
        c["uid"] = m
        c["host"] = 1 if m == L["host"] else 0
        cards.append(c)
    v = {"ok": True, "id": L["id"], "b": L["b"], "status": L["status"], "members": cards, "host": L["host"] == uid,
         "me": L["members"].index(uid) if uid in L["members"] else -1, "link": app_link("gr_" + L["id"]),
         "max": GR_MAX, "expired": L["status"] == "open" and L["created"] < time.time() - GR_TTL, "public": L.get("public", 0),
         "lo": L["b"] - gr_lo(L["b"]), "hi": L["b"] + gr_hi(L["b"])}
    if L["status"] == "done" and L["result"]:
        try:
            R = json.loads(L["result"])
        except ValueError:
            R = None
        if R:
            if not full:
                R.pop("hs", None)
            v["result"] = R
            c = db.execute("SELECT reward, claimed FROM gr_claims WHERE uid=? AND lobby=?", (uid, L["id"])).fetchone()
            if c:
                v["claimed"] = bool(c[1])
    return v

def gr_new(user, body):
    if not rate_ok(user["id"], "gr_new"):
        return SLOW(user["id"], "gr_new")
    uid, b = user["id"], as_int(body.get("b"), 0, 100000)
    with db_lock:
        if is_flagged(uid):
            return 200, {"ok": False, "reason": "review"}
        lv, sv = _gr_level(uid)
        if not sv:
            return 200, {"ok": False, "reason": "nosave_me"}
        if b not in gr_for(lv):
            return 200, {"ok": False, "reason": "level"}
        if _gr_won_today(uid, b):
            return 200, {"ok": False, "reason": "today"}
        # one open group per host: an old one closes
        for (og,) in db.execute("SELECT id FROM gr_lobby WHERE host=? AND status='open'", (uid,)).fetchall():
            threading.Thread(target=gr_note_done, args=(og, "Эта группа закрыта."), daemon=True).start()
        db.execute("UPDATE gr_lobby SET status='closed' WHERE host=? AND status='open'", (uid,))
        gid = base64.urlsafe_b64encode(os.urandom(6)).decode().replace("-", "x").replace("_", "y")
        db.execute("INSERT INTO gr_lobby(id, b, host, members, created) VALUES(?,?,?,?,?)", (gid, b, uid, json.dumps([uid]), time.time()))
        db.commit()
        L = _gr_row(gid)
        v = _gr_view(L, uid)
        db.commit()
    return 200, v

def gr_get(user, gid):
    with db_lock:
        L = _gr_row(str(gid)[:16])
        if not L:
            return 404, {"ok": False, "reason": "none"}
        v = _gr_view(L, user["id"], full=True)
        db.commit()
    return 200, v

def gr_join(user, body):
    if not rate_ok(user["id"], "gr_join"):
        return SLOW(user["id"], "gr_join")
    uid, gid = user["id"], str(body.get("id", ""))[:16]
    with db_lock:
        L = _gr_row(gid)
        if not L:
            return 404, {"ok": False, "reason": "none"}
        if uid in L["members"]:
            v = _gr_view(L, uid); db.commit()
            return 200, v
        if L["status"] != "open":
            return 200, {"ok": False, "reason": "started" if L["status"] == "done" else "closed"}
        if L["created"] < time.time() - GR_TTL:
            return 200, {"ok": False, "reason": "expired"}
        if len(L["members"]) >= GR_MAX:
            return 200, {"ok": False, "reason": "full"}
        if is_flagged(uid):
            return 200, {"ok": False, "reason": "review"}
        lv, sv = _gr_level(uid)
        if not sv:
            return 200, {"ok": False, "reason": "nosave_me"}
        if L["b"] not in gr_for(lv):
            return 200, {"ok": False, "reason": "level", "b": L["b"], "lv": lv}
        if _gr_won_today(uid, L["b"]):
            return 200, {"ok": False, "reason": "today"}
        L["members"].append(uid)
        db.execute("UPDATE gr_lobby SET members=? WHERE id=?", (json.dumps(L["members"]), gid))
        db.commit()
        if len(L["members"]) >= GR_MAX:
            threading.Thread(target=gr_note_done, args=(gid, "👥 Эта группа уже собрана."), daemon=True).start()
        v = _gr_view(L, uid)
        db.commit()
        host = L["host"]
        name = (db.execute("SELECT name FROM players WHERE id=?", (uid,)).fetchone() or ("Игрок",))[0]
    _tell(host, f"🛡 {name} вступил в твою группу на босса {L['b']} уровня ({len(L['members'])}/{GR_MAX}).")
    return 200, v

def gr_leave(user, body):
    uid, gid = user["id"], str(body.get("id", ""))[:16]
    with db_lock:
        L = _gr_row(gid)
        if not L or L["status"] != "open" or uid not in L["members"]:
            return 200, {"ok": True}
        if uid == L["host"]:
            db.execute("UPDATE gr_lobby SET status='closed' WHERE id=?", (gid,))
            threading.Thread(target=gr_note_done, args=(gid, "Эта группа закрыта."), daemon=True).start()
        else:
            L["members"].remove(uid)
            db.execute("UPDATE gr_lobby SET members=? WHERE id=?", (json.dumps(L["members"]), gid))
        db.commit()
    return 200, {"ok": True}

def gr_kick(user, body):
    if not rate_ok(user["id"], "gr_kick"):
        return SLOW(user["id"], "gr_kick")
    uid, gid, who = user["id"], str(body.get("id", ""))[:16], as_int(body.get("uid"), -10**15, 10**15)
    with db_lock:
        L = _gr_row(gid)
        if not L or L["status"] != "open" or uid != L["host"] or who == uid or who not in L["members"]:
            return 200, {"ok": False}
        L["members"].remove(who)
        db.execute("UPDATE gr_lobby SET members=? WHERE id=?", (json.dumps(L["members"]), gid))
        db.commit()
        v = _gr_view(L, uid)
        db.commit()
    return 200, v

def gr_bot(user, body):
    """Admins only, for testing: a bot joins the group as a copy of a real hero of a fitting level (or of the host)."""
    uid, gid = user["id"], str(body.get("id", ""))[:16]
    if uid not in ADMIN_IDS:
        return 403, {"ok": False, "reason": "admin"}
    with db_lock:
        L = _gr_row(gid)
        if not L or L["status"] != "open" or uid != L["host"]:
            return 200, {"ok": False, "reason": "closed"}
        if len(L["members"]) >= GR_MAX:
            return 200, {"ok": False, "reason": "full"}
        taken = {abs(m) for m in L["members"]}
        lo, hi = L["b"] - gr_lo(L["b"]), L["b"] + gr_hi(L["b"])
        rows = db.execute("SELECT p.id FROM players p JOIN saves s ON s.uid=p.id WHERE p.level BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 40", (lo, hi)).fetchall()
        bot = None
        for (pid,) in rows:
            if pid in taken:
                continue
            lv, sv = _gr_level(pid)
            if sv and lo <= lv <= hi:
                bot = -pid
                break
        if bot is None:
            n = sum(1 for m in L["members"] if m <= -GR_BOT)
            bot = -(GR_BOT + n + 1)
        L["members"].append(bot)
        db.execute("UPDATE gr_lobby SET members=? WHERE id=?", (json.dumps(L["members"]), gid))
        db.commit()
        v = _gr_view(L, uid)
        db.commit()
    return 200, v

def gr_public(user, body):
    """The host shows the group to everyone of a fitting level (or hides it again)."""
    if not rate_ok(user["id"], "gr_public"):
        return SLOW(user["id"], "gr_public")
    uid, gid, on = user["id"], str(body.get("id", ""))[:16], 1 if body.get("on") else 0
    with db_lock:
        L = _gr_row(gid)
        if not L or L["status"] != "open" or uid != L["host"]:
            return 200, {"ok": False, "reason": "closed"}
        db.execute("UPDATE gr_lobby SET public=? WHERE id=?", (on, gid))
        db.commit()
        L["public"] = on
        v = _gr_view(L, uid)
        who, host_name = [], ""
        if on and not db.execute("SELECT 1 FROM kv WHERE k=?", (f"grn:{gid}",)).fetchone() and len(L["members"]) < GR_MAX:
            if rate_ok(uid, "gr_notify"):
                db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (f"grn:{gid}", "1"))
                who = _gr_pick_note(L)
                host_name = (db.execute("SELECT name FROM players WHERE id=?", (uid,)).fetchone() or ("Игрок",))[0]
            else:
                v["notify_wait"] = rate_wait(uid, "gr_notify")
        db.commit()
    if who:
        threading.Thread(target=_gr_send_note, args=(gid, L["b"], host_name, GR_MAX - len(L["members"]), who), daemon=True).start()
    v["notified"] = len(who)
    return 200, v

def gr_list(user):
    """Open groups anyone may join: only bosses that fit the asker's level, not full, not his own, not one he beat today."""
    uid, day = user["id"], day_id()
    with db_lock:
        lv, _ = _gr_level(uid)
        fit = set(gr_for(lv)) if lv else set()
        won = {r[0] for r in db.execute("SELECT b FROM gr_claims WHERE uid=? AND day=?", (uid, day))}
        out = []
        for r in db.execute("SELECT id FROM gr_lobby WHERE public=1 AND status='open' AND created>? ORDER BY created DESC LIMIT 200",
                            (time.time() - GR_TTL,)).fetchall():
            L = _gr_row(r[0])
            if not L or L["b"] not in fit or L["b"] in won or uid in L["members"] or len(L["members"]) >= GR_MAX:
                continue
            hp = db.execute("SELECT name FROM players WHERE id=?", (L["host"],)).fetchone()
            hsv = _save_of(L["host"]) or {}
            out.append({"id": L["id"], "b": L["b"], "n": len(L["members"]), "host": hp[0] if hp else "Игрок",
                        "hlv": as_int(hsv.get("level"), 1, 100000), "hcls": str(hsv.get("cls", "knight"))[:16]})
            if len(out) >= 50:
                break
        db.commit()
    return 200, {"ok": True, "level": lv, "groups": out}

def gr_start(user, body):
    if not rate_ok(user["id"], "gr_start"):
        return SLOW(user["id"], "gr_start")
    uid, gid = user["id"], str(body.get("id", ""))[:16]
    with db_lock:
        L = _gr_row(gid)
        if not L:
            return 404, {"ok": False, "reason": "none"}
        if L["status"] == "done":
            v = _gr_view(L, uid, full=True); db.commit()
            return 200, v
        if L["status"] != "open":
            return 200, {"ok": False, "reason": "closed"}
        if uid != L["host"]:
            return 200, {"ok": False, "reason": "nothost"}
        if len(L["members"]) < 2:
            return 200, {"ok": False, "reason": "few"}
        saves, drop = [], []
        for m in L["members"]:
            if m < 0:
                sv = _gr_save_of(m, L["host"])
                (saves.append(sv) if sv else drop.append(m))
                continue
            lv, sv = _gr_level(m)
            if not sv or L["b"] not in gr_for(lv) or _gr_won_today(m, L["b"]) or is_flagged(m):
                drop.append(m)
            else:
                saves.append(sv)
        if drop:
            L["members"] = [m for m in L["members"] if m not in drop]
            db.execute("UPDATE gr_lobby SET members=? WHERE id=?", (json.dumps(L["members"]), gid))
            db.commit()
            return 200, {"ok": False, "reason": "dropped", "n": len(drop)}
        db.execute("UPDATE gr_lobby SET status='fighting' WHERE id=? AND status='open'", (gid,))
        db.commit()
        seed = _seed("gr" + gid)
        R = engine({"mode": "gr", "saves": saves, "b": L["b"], "seed": seed})
        if not R:
            db.execute("UPDATE gr_lobby SET status='open' WHERE id=?", (gid,))
            db.commit()
            return 200, {"ok": False, "reason": "engine"}
        R["b"], R["seed"], R["uids"] = L["b"], seed, L["members"]
        R["cards"] = [{"name": c["name"], "cls": c["cls"], "level": c["level"], "look": c["look"]} for c in _gr_view(L, uid)["members"]]
        rws = R.pop("rewards", None) or []
        day = day_id()
        if any(m < 0 for m in L["members"]):
            R["test"] = 1          # a fight with test bots: no reward and the boss is not marked as beaten today
        if R.get("win") and not R.get("test"):
            for i, m in enumerate(L["members"]):
                if m < 0:
                    continue
                rw = rws[i] if i < len(rws) else {"gold": 0}
                db.execute("INSERT OR IGNORE INTO gr_claims(uid, b, day, lobby, reward, claimed) VALUES(?,?,?,?,?,0)",
                           (m, L["b"], day, gid, json.dumps(rw)))
        R["rewards"] = rws if R.get("win") and not R.get("test") else []
        db.execute("UPDATE gr_lobby SET status='done', result=?, done_at=? WHERE id=?", (json.dumps(R), time.time(), gid))
        db.commit()
        threading.Thread(target=gr_note_done, args=(gid, "⚔️ Эту группу уже собрали — она ушла в бой."), daemon=True).start()
        L = _gr_row(gid)
        v = _gr_view(L, uid, full=True)
        db.commit()
        members = list(L["members"])
    for m in members:
        if m != uid and m > 0:
            _tell(m, f"🛡 Группа вышла на босса {L['b']} уровня — " + ("победа! Открой игру, чтобы посмотреть бой и забрать награду." if R.get("win") else "босс оказался сильнее. Соберитесь ещё раз!"))
    return 200, v

def gr_claim(user, body):
    uid, gid = user["id"], str(body.get("id", ""))[:16]
    with db_lock:
        r = db.execute("SELECT reward, claimed FROM gr_claims WHERE uid=? AND lobby=?", (uid, gid)).fetchone()
        if not r:
            return 200, {"ok": False, "reason": "none"}
        if r[1]:
            return 200, {"ok": False, "reason": "claimed"}
        cur = db.execute("UPDATE gr_claims SET claimed=1 WHERE uid=? AND lobby=? AND claimed=0", (uid, gid))
        db.commit()
        if cur.rowcount != 1:
            return 200, {"ok": False, "reason": "claimed"}
        try:
            rw = json.loads(r[0] or "{}")
        except ValueError:
            rw = {}
    return 200, {"ok": True, "id": gid, "reward": rw}

def gr_mine(user):
    uid, day = user["id"], day_id()
    with db_lock:
        done = [r[0] for r in db.execute("SELECT b FROM gr_claims WHERE uid=? AND day=?", (uid, day))]
        rows = db.execute("SELECT id FROM gr_lobby WHERE created>? AND status IN ('open','fighting','done') AND members LIKE ? ORDER BY created DESC LIMIT 20",
                          (time.time() - 2 * 86400, f"%{uid}%")).fetchall()
        open_, fresh = [], []
        for (gid,) in rows:
            L = _gr_row(gid)
            if not L or uid not in L["members"]:
                continue
            if L["status"] == "open" and L["created"] > time.time() - GR_TTL:
                open_.append({"id": gid, "b": L["b"], "n": len(L["members"]), "host": L["host"] == uid})
            elif L["status"] == "done":
                c = db.execute("SELECT claimed FROM gr_claims WHERE uid=? AND lobby=?", (uid, gid)).fetchone()
                try:
                    R = json.loads(L["result"] or "{}")
                except ValueError:
                    R = {}
                fresh.append({"id": gid, "b": L["b"], "win": bool(R.get("win")), "test": 1 if R.get("test") else 0, "unclaimed": bool(c and not c[0]), "at": L["done_at"]})
        lv, _ = _gr_level(uid)
        db.commit()
    return 200, {"ok": True, "done": done, "open": open_, "recent": fresh[:8], "level": lv, "bosses": gr_for(lv) if lv else []}


# ---------------------------------------------------------------- NFT: a very rare drop from a beaten tower boss
# The roll is made here, never on the phone. The owner hands the NFTs out himself: the player presses «Вывести»
# in «Мои награды», the bot tells the owners, they send the gift and press «Выдал» under that message.
db.execute("""CREATE TABLE IF NOT EXISTS nft_drops(id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER, name TEXT, room INTEGER,
              ts REAL, status TEXT DEFAULT 'new', req_ts REAL, done_ts REAL)""")
if "link" not in [c[1] for c in db.execute("PRAGMA table_info(nft_drops)")]:
    db.execute("ALTER TABLE nft_drops ADD COLUMN link TEXT")
db.commit()
NFT_RATE_DEFAULT = 0.01          # percent per beaten boss: one boss in 10 000
NFT_POOL_DEFAULT = ["NFT еБашни"]
NFT_FLOOR = 250                  # only bosses from this floor up can drop one (250, 300, 350…)
NFT_GAP = 15                     # seconds between two counted bosses of one player (a boss fight is longer than that)
NFT_DAY_CAP = 300                # bosses a day that can roll at all
NFT_ST = {"new": "получено", "pending": "на выводе", "done": "выдано", "rejected": "отклонено"}

def _kv_get(k, dflt=None):
    r = db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return r[0] if r else dflt

def _kv_set(k, v):
    db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (k, str(v)))

def nft_rate():
    try:
        return max(0.0, min(100.0, float(_kv_get("nft:rate", NFT_RATE_DEFAULT))))
    except ValueError:
        return NFT_RATE_DEFAULT

def nft_cap():
    return as_int(_kv_get("nft:cap", NFT_DAY_CAP), 1, 10**6)

def nft_pool():
    try:
        p = json.loads(_kv_get("nft:pool", "null") or "null") or []
        return [str(x)[:300] for x in p if str(x).strip()] or NFT_POOL_DEFAULT
    except (ValueError, TypeError):
        return NFT_POOL_DEFAULT

def _nft_split(entry):
    """«Plush Pepe | https://t.me/nft/PlushPepe-1» → name and the gift's page (the link is optional)."""
    name, _, link = str(entry).partition("|")
    link = link.strip()
    return name.strip()[:60], (link if link.startswith("https://") else "")

def _nft_row(r):
    return {"id": r[0], "name": r[1], "room": r[2], "ts": int(r[3] * 1000), "status": r[4], "st": NFT_ST.get(r[4], r[4]), "link": r[5] or ""}

def _nft_list(uid):
    return [_nft_row(r) for r in db.execute("SELECT id, name, room, ts, status, link FROM nft_drops WHERE uid=? ORDER BY id DESC", (uid,))]

def _admins_tell(text, markup=None):
    for a in ADMIN_IDS:
        tg_try("sendMessage", chat_id=a, text=text, parse_mode="HTML", disable_web_page_preview=True, **({"reply_markup": markup} if markup else {}))

def _who(uid):
    r = db.execute("SELECT name, username, room FROM players WHERE id=?", (uid,)).fetchone() or ("Игрок", None, 0)
    return f"{mention(uid, r[0], r[1])} (id <code>{int(uid)}</code>, этаж {r[2] or 0})"

def _nft_give(uid, room, why, pick=None):
    """Caller holds db_lock. Records one NFT and returns it."""
    name, link = pick or _nft_split(random.choice(nft_pool()))
    now = time.time()
    cur = db.execute("INSERT INTO nft_drops(uid, name, room, ts, link) VALUES(?,?,?,?,?)", (uid, name, room, now, link))
    db.commit()
    nid = cur.lastrowid
    who = _who(uid)
    threading.Thread(target=_admins_tell, args=(f"🎉 Выпало NFT «{html_esc(name)}» (#{nid})" + (f"\n{html_esc(link)}" if link else "") + f"\nИгрок: {who}\n{why}",), daemon=True).start()
    log.info("nft #%s %r to %s (%s)", nid, name, uid, why)
    return {"id": nid, "name": name, "room": room, "ts": int(now * 1000), "status": "new", "st": NFT_ST["new"], "link": link}

def nft_boss(user, body):
    """The game calls this after a tower boss from floor 250 is beaten for the first time on the climb (never from the farm)."""
    uid, room = user["id"], as_int(body.get("room"), 0, 10**7)
    if room < NFT_FLOOR or room % 50:
        return 200, {"ok": True, "nft": None}
    now = time.time()
    with db_lock:
        sv = _save_of(uid) or {}
        top = max(as_int(sv.get("maxCleared"), 0, 10**7), _player_room(uid) or 0)
        # only a boss beaten for the first time on the climb: each floor rolls once per player, ever (farming it again,
        # or starting over with «Новая игра», gives nothing), and it has to be the new record, not one far below it
        done = as_int(_kv_get(f"nftmax:{uid}", 0), 0, 10**7)
        if room > top + 50 or room < top // 50 * 50 or room <= done:
            return 200, {"ok": True, "nft": None}
        flagged = is_flagged(uid)
        last = float(_kv_get(f"nftlast:{uid}", 0) or 0)
        dk = f"nftn:{uid}:{q_day()}"
        n = as_int(_kv_get(dk, 0), 0, 10**9)
        if now - last < NFT_GAP or n >= nft_cap():
            return 200, {"ok": True, "nft": None}
        _kv_set(f"nftlast:{uid}", now)
        _kv_set(f"nftmax:{uid}", room)
        _kv_set(dk, n + 1)
        _kv_set("nft:rolls", as_int(_kv_get("nft:rolls", 0), 0, 10**12) + 1)
        db.commit()
        if random.random() * 100 >= nft_rate():
            return 200, {"ok": True, "nft": None}
        if flagged:
            # the anticheat has this player marked: the owner decides, the player sees nothing until then
            name, link = _nft_split(random.choice(nft_pool()))
            tok = hashlib.sha1(f"{uid}:{now}".encode()).hexdigest()[:12]
            _kv_set(f"nfg:{tok}", json.dumps({"uid": uid, "room": room, "name": name, "link": link}, ensure_ascii=False))
            db.commit()
            who = _who(uid)
            kb = {"inline_keyboard": [[{"text": "✅ Выдать всё равно", "callback_data": f"nf:g:{tok}"}, {"text": "❌ Не выдавать", "callback_data": f"nf:x:{tok}"}]]}
            threading.Thread(target=_admins_tell, args=(f"⚠️ NFT «{html_esc(name)}» выбил игрок под античитом\nИгрок: {who}\nБосс {room} этажа\n\n"
                                                        "Пока он ничего не получил. Выдать?", kb), daemon=True).start()
            log.info("nft roll won by flagged %s: %r, waiting for the owner", uid, name)
            return 200, {"ok": True, "nft": None}
        got = _nft_give(uid, room, f"Босс {room} этажа")
    return 200, {"ok": True, "nft": got}

def nft_mine(user):
    with db_lock:
        return 200, {"ok": True, "items": _nft_list(user["id"]), "rate": nft_rate()}

def nft_withdraw(user, body):
    uid, nid = user["id"], as_int(body.get("id"), 0, 10**12)
    with db_lock:
        r = db.execute("SELECT name, status FROM nft_drops WHERE id=? AND uid=?", (nid, uid)).fetchone()
        if not r:
            return 404, {"ok": False, "reason": "not found"}
        if r[1] != "new":
            return 200, {"ok": True, "items": _nft_list(uid)}
        db.execute("UPDATE nft_drops SET status='pending', req_ts=? WHERE id=?", (time.time(), nid))
        db.commit()
        who = _who(uid)
        items = _nft_list(uid)
    kb = {"inline_keyboard": [[{"text": "✅ Выдал", "callback_data": f"nf:d:{nid}"}, {"text": "❌ Отклонить", "callback_data": f"nf:r:{nid}"}]]}
    threading.Thread(target=_admins_tell, args=(f"📤 Заявка на вывод NFT «{html_esc(r[0])}» (#{nid})\nИгрок: {who}\n\n"
                                                "Отправь подарок и нажми «Выдал» — игроку придёт уведомление.", kb), daemon=True).start()
    return 200, {"ok": True, "items": items}

def nft_callback(cq):
    """nf:d:<id> — the owner handed the NFT out, nf:r:<id> — refused. The player gets a message either way."""
    me = (cq.get("from") or {}).get("id")
    if me not in ADMIN_IDS:
        tg_try("answerCallbackQuery", callback_query_id=cq["id"])
        return
    parts = (cq.get("data") or "").split(":")
    if len(parts) == 3 and parts[1] in ("g", "x"):
        with db_lock:
            raw = _kv_get(f"nfg:{parts[2]}")
            if not raw:
                tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Уже решено")
                return
            db.execute("DELETE FROM kv WHERE k=?", (f"nfg:{parts[2]}",))
            d = json.loads(raw)
            got = _nft_give(d["uid"], d["room"], "Выдано вручную (игрок под античитом)", (d["name"], d.get("link") or "")) if parts[1] == "g" else None
            db.commit()
            pm = db.execute("SELECT can_pm FROM players WHERE id=?", (d["uid"],)).fetchone()
        m = cq.get("message") or {}
        if m:
            tg_try("editMessageText", chat_id=m["chat"]["id"], message_id=m["message_id"], disable_web_page_preview=True,
                   text=(m.get("text") or "") + ("\n\n✅ Выдано" if got else "\n\n❌ Не выдано"))
        tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Выдано" if got else "Не выдаём")
        if got and pm and pm[0]:
            tg_try("sendMessage", chat_id=d["uid"], text=f"🎁 С босса тебе выпало NFT «{got['name']}»! Открой игру → «Задания» → «Мои награды» и нажми «Вывести».")
        return
    act, nid = (parts[1], as_int(parts[2], 0, 10**12)) if len(parts) == 3 else ("", 0)
    with db_lock:
        r = db.execute("SELECT uid, name, status FROM nft_drops WHERE id=?", (nid,)).fetchone()
        if not r or r[2] != "pending" or act not in ("d", "r"):
            tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Эта заявка уже закрыта")
            return
        st = "done" if act == "d" else "rejected"
        db.execute("UPDATE nft_drops SET status=?, done_ts=? WHERE id=?", (st, time.time(), nid))
        db.commit()
        pm = db.execute("SELECT can_pm FROM players WHERE id=?", (r[0],)).fetchone()
    m = cq.get("message") or {}
    if m:
        tg_try("editMessageText", chat_id=m["chat"]["id"], message_id=m["message_id"], parse_mode="HTML", disable_web_page_preview=True,
               text=html_esc(m.get("text") or "") + ("\n\n✅ Выдано" if act == "d" else "\n\n❌ Отклонено"))
    tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Отмечено")
    if pm and pm[0]:
        txt = (f"🎁 Твоё NFT «{r[1]}» отправлено! Проверь подарки в своём профиле Telegram." if act == "d"
               else f"Заявка на вывод NFT «{r[1]}» отклонена. Напиши в поддержку, если это ошибка.")
        tg_try("sendMessage", chat_id=r[0], text=txt)

def nft_command(msg):
    """/nft (or /нфт), owners only, in the bot's private chat: what dropped and to whom, and the settings.
       /nft шанс 0.01 — chance in percent per boss; /nft список A; B; C — what can drop; /nft тест — give yourself one."""
    me = (msg.get("from") or {}).get("id")
    if me not in ADMIN_IDS:
        return
    chat = msg["chat"]["id"]
    args = (msg.get("text") or "").split(None, 1)
    rest = args[1].strip() if len(args) > 1 else ""
    low = rest.lower()
    with db_lock:
        if low.startswith(("шанс", "rate")):
            try:
                v = float(rest.split(None, 1)[1].replace(",", ".").rstrip("%"))
                _kv_set("nft:rate", max(0.0, min(100.0, v)))
                db.commit()
                return tg("sendMessage", chat_id=chat, text=f"Шанс NFT с босса: {nft_rate():g}% (1 на {round(100 / nft_rate()) if nft_rate() else '∞'} боссов)")
            except (IndexError, ValueError):
                r = nft_rate()
                return tg("sendMessage", chat_id=chat, text=f"Сейчас шанс: {r:g}% за босса (1 на {round(100 / r) if r else '∞'}).\nИзменить: /nft шанс 0.01")
        if low.startswith(("лимит", "cap")):
            try:
                _kv_set("nft:cap", max(1, int(rest.split(None, 1)[1])))
                db.commit()
                return tg("sendMessage", chat_id=chat, text=f"Лимит: {nft_cap()} боссов в день на игрока, дальше шанс не проверяется")
            except (IndexError, ValueError):
                return tg("sendMessage", chat_id=chat, text="Так: /nft лимит 300")
        if low.startswith(("список", "pool")):
            names = [x.strip() for x in rest.split(None, 1)[1:][0].replace("\n", ";").split(";")] if len(rest.split(None, 1)) > 1 else []
            names = [x for x in names if x]
            if not names:
                return tg("sendMessage", chat_id=chat, text="Так: /nft список Plush Pepe; Durov's Cap | https://t.me/nft/DurovsCap-1\n"
                                                           "Через «;» — варианты (выпадают поровну), после «|» — необязательная ссылка на подарок.")
            _kv_set("nft:pool", json.dumps(names, ensure_ascii=False))
            db.commit()
            return tg("sendMessage", chat_id=chat, disable_web_page_preview=True, text="Теперь может выпасть (поровну):\n• " + "\n• ".join(
                (lambda n, l: n + (f" — {l}" if l else ""))(*_nft_split(x)) for x in names))
        if low.startswith(("тест", "test")):
            got = _nft_give(me, 0, "Тестовая выдача командой /nft тест")
            return tg("sendMessage", chat_id=chat, text=f"Выдал тебе тестовое NFT «{got['name']}» (#{got['id']}). Открой игру → Задания → «Мои награды».")
        rows = db.execute("""SELECT d.id, d.uid, d.name, d.room, d.ts, d.status, p.name, p.username FROM nft_drops d
                             LEFT JOIN players p ON p.id=d.uid ORDER BY d.id DESC""").fetchall()
        rolls = as_int(_kv_get("nft:rolls", 0), 0, 10**12)
        rate, pool = nft_rate(), nft_pool()
    when = lambda t: time.strftime("%d.%m %H:%M", time.gmtime(t + AC_TZ * 3600)) if t else "—"
    by_name, by_st = {}, {}
    for r in rows:
        by_name[r[2]] = by_name.get(r[2], 0) + 1
        by_st[r[5]] = by_st.get(r[5], 0) + 1
    head = (f"💎 <b>NFT с боссов</b>\n\nШанс: {rate:g}% за босса с {NFT_FLOOR} этажа (1 на {round(100 / rate) if rate else '∞'})\n"
            f"Может выпасть: {html_esc(', '.join(_nft_split(x)[0] for x in pool))}" + (" ⚠️ это заглушка — задай свои: /nft список" if pool == NFT_POOL_DEFAULT else "") + f"\nБоссов с бросками: {rolls} · лимит {nft_cap()} в день на игрока\n\n"
            f"Выпало всего: <b>{sum(1 for r in rows if r[3])}</b>" + (f" (и тестовых: {sum(1 for r in rows if not r[3])})" if any(not r[3] for r in rows) else "") + "\n"
            + ("".join(f"• {html_esc(k)}: {v}\n" for k, v in sorted(by_name.items(), key=lambda x: -x[1])) if rows else "")
            + f"\nЖдут вывода: <b>{by_st.get('pending', 0)}</b> · выдано: {by_st.get('done', 0)} · не выведено: {by_st.get('new', 0)}"
            + (f" · отклонено: {by_st['rejected']}" if by_st.get("rejected") else ""))
    # room 0 is what «/nft тест» gives: no boss behind it
    where = lambda room: f"с босса {room} этажа" if room else "тестовая выдача"
    lines = [f"#{r[0]} {html_esc(r[2])} — {mention(r[1], r[6], r[7])}, {where(r[3])}, {when(r[4])} · {NFT_ST.get(r[5], r[5])}" for r in rows[:40]]
    tail = ("\n\nПоследние:\n" + "\n".join(lines)) if lines else ""
    tail += "\n\nНастройки:\n/nft шанс 0.01\n/nft лимит 300\n/nft список Имя1; Имя2 | ссылка на подарок\n/nft тест — выдать себе для проверки"
    text = head + tail
    for i in range(0, len(text), 3900):
        tg("sendMessage", chat_id=chat, text=text[i:i + 3900], parse_mode="HTML", disable_web_page_preview=True)

def nft_stats_line():
    """One line for /статистика. Caller holds db_lock."""
    n = db.execute("SELECT COUNT(*), SUM(status='pending') FROM nft_drops").fetchone()
    return f"NFT: выпало {n[0] or 0}, ждут вывода {n[1] or 0} (подробно: /nft)"

# ---------------------------------------------------------------- http
BOT_USERNAME = ""

# ---- brotli for the game page (v196): Python has no brotli of its own, Node (already here for duels) does it once per version
_br_cache, _br_busy, _br_lock = {}, set(), threading.Lock()
_BR_JS = ("const z=require('zlib');const b=[];process.stdin.on('data',d=>b.push(d));process.stdin.on('end',()=>"
          "process.stdout.write(z.brotliCompressSync(Buffer.concat(b),{params:{[z.constants.BROTLI_PARAM_QUALITY]:11}})))")
def _br_make(raw, key):
    try:
        r = subprocess.run(["node", "-e", _BR_JS], input=raw, capture_output=True, timeout=60)
        if r.returncode == 0 and r.stdout:
            with _br_lock:
                if len(_br_cache) > 20:
                    _br_cache.clear()
                _br_cache[key] = r.stdout
    except Exception as e:
        log.info("brotli: %s", e)
    finally:
        with _br_lock:
            _br_busy.discard(key)

def brotli_of(raw, key):
    """The brotli copy if it is ready; otherwise start making it in the background and answer plain (Caddy gzips that) this time."""
    with _br_lock:
        if key in _br_cache:
            return _br_cache[key]
        if key in _br_busy:
            return None
        _br_busy.add(key)
    threading.Thread(target=_br_make, args=(raw, key), daemon=True).start()
    return None

class Handler(BaseHTTPRequestHandler):
    server_version = "Emberspire"

    def log_message(self, fmt, *args):
        pass

    def send_bytes(self, code, raw, ctype, cache="no-cache"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", cache)
        try:
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass    # the player closed the app before the answer arrived: nothing to do

    def send_media(self, raw, ctype):
        """Pictures and the title video. iPhones play a video only from a server that answers byte ranges (206)."""
        # v196: a week in the phone's cache, and after that a cheap check (304) instead of the whole video or song again
        lm = getattr(self, "_media_mtime", None)
        lms = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime(lm)) if lm else None
        if lms and self.headers.get("If-Modified-Since") == lms and not self.headers.get("Range"):
            self.send_response(304)
            self.send_header("Last-Modified", lms)
            self.send_header("Cache-Control", "public, max-age=604800")
            self.end_headers()
            return
        rng = self.headers.get("Range", "")
        start, end = 0, len(raw) - 1
        partial = False
        if rng.startswith("bytes="):
            try:
                a_, b_ = rng[6:].split(",")[0].split("-")
                if a_:
                    start, end = int(a_), (int(b_) if b_ else len(raw) - 1)
                else:
                    start = max(0, len(raw) - int(b_))
                end = min(end, len(raw) - 1)
                partial = start <= end
            except ValueError:
                partial = False
            if not partial:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{len(raw)}")
                self.end_headers()
                return
        body = raw[start:end + 1]
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=604800")
        if lms:
            self.send_header("Last-Modified", lms)
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(raw)}")
        try:
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_json(self, code, obj):
        self.send_bytes(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8", "no-store")

    def signed(self):
        return check_init_data(self.headers.get("X-Init-Data", ""))

    def body(self, limit):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n > limit:
                return None
            b = json.loads(self.rfile.read(n) or b"{}")
            return b if isinstance(b, dict) else {}
        except (ValueError, TypeError):
            return {}

    def send_nftimg(self, n):
        """The picture of a Telegram NFT gift, taken from Fragment once and kept on our server: some players' networks
        do not reach fragment.com, and a picture from the game's own address always loads."""
        n = str(n).lower()
        if not NFT_IMG_RE.match(n):
            return self.send_json(400, {"ok": False})
        data = nft_img(n)
        if not data:
            return self.send_json(404, {"ok": False})
        self.send_response(200)
        self.send_header("Content-Type", "image/webp")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=604800")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        if path == "/api/health":
            return self.send_json(200, {"ok": True})
        if path == "/api/notice":
            return self.send_json(*notice_get())
        if path == "/api/season":
            return self.send_json(*season_get())
        if path == "/api/nftimg":
            return self.send_nftimg(urllib.parse.parse_qs(url.query).get("n", [""])[0])
        if path.startswith("/api/"):
            u, f = self.signed()
            if not u:
                return self.send_json(401, {"ok": False, "reason": "not signed in"})
            ensure_player(u)
            if path == "/api/leaderboard":
                return self.send_json(*leaderboard(u, urllib.parse.parse_qs(url.query).get("cls", [""])[0]))
            if path == "/api/ref":
                return self.send_json(*ref_info(u))
            if path == "/api/raid":
                return self.send_json(*raid_get(u, f, urllib.parse.parse_qs(url.query).get("ci", [""])[0]))
            if path == "/api/raid/stats":
                return self.send_json(*raid_stats(u, urllib.parse.parse_qs(url.query).get("ci", [""])[0], f))
            if path == "/api/save":
                return self.send_json(*save_get(u, urllib.parse.parse_qs(url.query)))
            if path == "/api/duel":
                return self.send_json(*duel_get(u, urllib.parse.parse_qs(url.query).get("id", [""])[0]))
            if path == "/api/duel/mine":
                return self.send_json(*duel_mine(u))
            if path == "/api/admin/ac":
                return self.send_json(*ac_admin_get(u))
            if path == "/api/stars":
                return self.send_json(*stars_get(u))
            if path == "/api/quests":
                return self.send_json(*quests_get(u))
            if path == "/api/nft":
                return self.send_json(*nft_mine(u))
            if path == "/api/gr":
                return self.send_json(*gr_get(u, urllib.parse.parse_qs(url.query).get("id", [""])[0]))
            if path == "/api/gr/mine":
                return self.send_json(*gr_mine(u))
            if path == "/api/gr/list":
                return self.send_json(*gr_list(u))
            if path == "/api/admin/dash":
                return self.send_json(*dash_data(u, urllib.parse.parse_qs(url.query)))
            if path == "/api/ghost":
                return self.send_json(*ghost_find(u, urllib.parse.parse_qs(url.query).get("room", ["0"])[0]))
            return self.send_json(404, {"ok": False})
        if path in ("/stats", "/stats/"):
            return self.send_bytes(200, STATS_PAGE.encode(), "text/html; charset=utf-8", "no-store")
        if path.startswith("/cards/"):
            name = os.path.basename(path)
            full = os.path.join(CARDS, name)
            if not name.endswith(".jpg") or not os.path.isfile(full):
                return self.send_json(404, {"ok": False})
            with open(full, "rb") as fh:
                return self.send_bytes(200, fh.read(), "image/jpeg", "public, max-age=604800")
        # static files from ./public, index.html for the root
        rel = "index.html" if path in ("", "/") else "terms.html" if path in ("/terms", "/terms/") else path.lstrip("/")
        full = os.path.normpath(os.path.join(PUBLIC, rel))
        if not full.startswith(PUBLIC + os.sep) or not os.path.isfile(full):
            return self.send_json(404, {"ok": False})
        with open(full, "rb") as fh:
            raw = fh.read()
        if full.endswith((".mp4", ".jpg", ".png", ".webm", ".mp3")):
            self._media_mtime = int(os.path.getmtime(full))
            return self.send_media(raw, mimetypes.guess_type(full)[0] or "application/octet-stream")
        if full.endswith(".html"):
            # tell the game the bot and Mini App names, so invite links point to the right place
            cfg = f'<script>window.EMBER_BOT={json.dumps(BOT_USERNAME)};window.EMBER_APP={json.dumps(APP_NAME)};</script>'
            raw = raw.replace(b"<head>", b"<head>" + cfg.encode(), 1)
            if b"{{SUPPORT" in raw:
                sup = SUPPORT_URL or (f"https://t.me/{BOT_USERNAME}" if BOT_USERNAME else "#")
                raw = raw.replace(b"{{SUPPORT}}", _html.escape(sup).encode()).replace(b"{{SUPPORT_TEXT}}", _html.escape("Написать в поддержку" if SUPPORT_URL else "Написать боту").encode())
        # v196: an ETag (a phone that has this version gets a tiny 304), brotli for pages and scripts (≈20% smaller than gzip),
        # and the picture files in public/a/ (their names carry a hash) are kept by phones for a year
        etag = '"' + hashlib.md5(raw).hexdigest()[:20] + '"'
        cache = "public, max-age=31536000, immutable" if rel.startswith("a/") else "no-cache"
        if self.headers.get("If-None-Match", "") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache)
            self.end_headers()
            return
        ctype = (mimetypes.guess_type(full)[0] or "application/octet-stream") + ("; charset=utf-8" if full.endswith((".html", ".js")) else "")
        enc = None
        if full.endswith((".html", ".js")) and "br" in self.headers.get("Accept-Encoding", "") and len(raw) > 2048:
            br = brotli_of(raw, etag)
            if br:
                raw, enc = br, "br"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", cache)
        self.send_header("ETag", etag)
        self.send_header("Vary", "Accept-Encoding")
        if enc:
            self.send_header("Content-Encoding", enc)
        try:
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        u, f = self.signed()
        if not u:
            return self.send_json(401, {"ok": False, "reason": "not signed in"})
        if path not in ("/api/stars/invoice",) and not rate_ok(u["id"], "post"):
            return self.send_json(429, {"ok": False, "reason": "slow"})
        is_new = ensure_player(u)
        body = self.body(600_000 if path in ("/api/share/prepare", "/api/duel/card") else 2_000_000 if path == "/api/save" else 16_384 if path == "/api/ev" else 4096)
        if body is None:
            return self.send_json(413, {"ok": False})
        routes = {
            "/api/score": lambda: submit_score(u, body),
            "/api/hello": lambda: hello(u, f, is_new, body),
            "/api/ev": lambda: ev_log(u, body),
            "/api/ref/claim": lambda: ref_claim(u),
            "/api/raid/hit": lambda: raid_hit(u, f, body),
            "/api/raid/join": lambda: raid_join(u, f, body),
            "/api/raid/claim": lambda: raid_claim(u, f, body),
            "/api/save": lambda: save_put(u, body),
            "/api/session/ping": lambda: session_ping(u, body),
            "/api/quests/channel": lambda: quest_channel(u),
            "/api/admin/notice": lambda: notice_set(u, body),
            "/api/admin/wipe": lambda: admin_wipe(u, body),
            "/api/admin/season": lambda: season_set(u, body),
            "/api/admin/ac": lambda: ac_admin_set(u, body),
            "/api/stars/topup": lambda: stars_topup(u, body),
            "/api/stars/invoice": lambda: stars_invoice(u, body),
            "/api/admin/stars": lambda: stars_mode(u, body),
            "/api/stars/buy": lambda: stars_buy(u, body),
            "/api/stars/skip": lambda: stars_skip(u),
            "/api/luck": lambda: luck_spin(u, body),
            "/api/luck/info": lambda: luck_info(u),
            "/api/quests/claim": lambda: quests_claim(u, body),
            "/api/nft/boss": lambda: nft_boss(u, body),
            "/api/nft/withdraw": lambda: nft_withdraw(u, body),
            "/api/notify": lambda: notify_set(u, body),
            "/api/rest": lambda: rest_set(u, body),
            "/api/share/prepare": lambda: share_prepare(u, body),
            "/api/duel/new": lambda: duel_new(u, body),
            "/api/duel/accept": lambda: duel_accept(u, body),
            "/api/duel/direct": lambda: duel_direct(u, body),
            "/api/duel/decline": lambda: duel_decline(u, body),
            "/api/ghost/fight": lambda: ghost_fight(u, body),
            "/api/duel/card": lambda: duel_card(u, body),
            "/api/gr/new": lambda: gr_new(u, body),
            "/api/gr/join": lambda: gr_join(u, body),
            "/api/gr/leave": lambda: gr_leave(u, body),
            "/api/gr/kick": lambda: gr_kick(u, body),
            "/api/gr/start": lambda: gr_start(u, body),
            "/api/gr/claim": lambda: gr_claim(u, body),
            "/api/gr/bot": lambda: gr_bot(u, body),
            "/api/gr/public": lambda: gr_public(u, body),
        }
        fn = routes.get(path)
        return self.send_json(*(fn() if fn else (404, {"ok": False})))

# ---------------------------------------------------------------- statistics for the owner (v193)
_ev_rate = {}
def ev_log(user, body):
    """The game sends fights on new floors in small batches: floor, boss/elite/ordinary, win, which try, the hero."""
    uid, now = user["id"], time.time()
    w = _ev_rate.get(uid)
    if not w or now - w[0] > 600:
        w = _ev_rate[uid] = [now, 0]
    evs = body.get("ev")
    if not isinstance(evs, list):
        return 400, {"ok": False}
    rows = []
    for e in evs[:20]:
        if not isinstance(e, dict) or w[1] >= 400:      # a hero can't fight more than ~40 times a minute: anything past that is noise
            break
        w[1] += 1
        kind = e.get("k") if e.get("k") in ("n", "e", "b") else "n"
        rows.append((uid, now, as_int(e.get("r"), 1, 100000), kind, 1 if e.get("w") else 0, as_int(e.get("t"), 1, 1000),
                     as_int(e.get("d"), 0, 3600), str(e.get("c") or "")[:16], as_int(e.get("l"), 1, 100000),
                     as_int(e.get("hp"), 0, 10**12), as_int(e.get("atk"), 0, 10**12), as_int(e.get("df"), 0, 10**12),
                     as_int(e.get("q"), 0, 60), 1 if e.get("a") else 0))
    if rows:
        with db_lock:
            db.executemany("INSERT INTO fight_log VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
            db.commit()
    return 200, {"ok": True}

def _median(a):
    a = sorted(a)
    return 0 if not a else a[len(a) // 2] if len(a) % 2 else (a[len(a) // 2 - 1] + a[len(a) // 2]) / 2

SPEND_RU = {"skips": "Пропуск отдыха", "luck": "Удача", "reset": "Сброс умений", "path": "Сброс пути", "class": "Смена класса",
            "autofarm": "Автофарм"}
BANDS = [(1, 99, "1–99"), (100, 299, "100–299"), (300, 599, "300–599"), (600, 10**9, "600+")]
FLOOR_BUCKETS = [(0, 0, "0"), (1, 24, "1–24"), (25, 49, "25–49"), (50, 99, "50–99"), (100, 149, "100–149"), (150, 199, "150–199"),
                 (200, 299, "200–299"), (300, 399, "300–399"), (400, 599, "400–599"), (600, 999, "600–999"), (1000, 10**9, "1000+")]

def dash_data(user, q):
    """Everything the owner's statistics page shows, counted here so the page only draws."""
    if user["id"] not in ADMIN_IDS:
        return 403, {"ok": False}
    days = as_int((q.get("days") or ["30"])[0], 1, 365)
    now = time.time()
    today = int((now + AC_TZ_S) // 86400)
    d0 = today - days + 1
    t0 = d0 * 86400 - AC_TZ_S
    dayof = lambda ts: int((ts + AC_TZ_S) // 86400)
    with db_lock:
        pl = db.execute("SELECT id, name, username, cls, room, level, first_seen, COALESCE(NULLIF(seen,0), updated, 0), flagged FROM players").fetchall()
        sv = {}
        for uid, data in db.execute("SELECT uid, data FROM saves"):
            try:
                d = json.loads(data)
                sv[uid] = (int(d.get("level") or 0), int(d.get("maxCleared") or 0), str(d.get("cls") or ""))
            except (ValueError, TypeError):
                pass
        act = dict(db.execute("SELECT day, COUNT(*) FROM act WHERE day>=? GROUP BY day", (d0,)).fetchall())
        act_any = db.execute("SELECT COUNT(DISTINCT uid) FROM act WHERE day>=?", (d0,)).fetchone()[0]
        fights = db.execute("SELECT uid, room, kind, win, tries, dur, cls, ts, q, auto FROM fight_log WHERE ts>=?", (t0,)).fetchall()
        pays = db.execute("SELECT uid, n, ts FROM star_pay WHERE refunded=0").fetchall()
        spend = db.execute("SELECT uid, what, -delta, ts FROM star_ledger WHERE delta<0 AND what<>'refund' AND ts>=?", (t0,)).fetchall()
    P = {}
    for uid, name, un, cls, room, level, first, seen, flagged in pl:
        lv, mc, sc = sv.get(uid, (0, 0, ""))
        P[uid] = {"name": name or "Игрок", "un": un or "", "cls": sc or cls or "", "floor": max(room or 0, mc), "level": max(level or 0, lv) or 1,
                  "first": first or 0, "seen": seen or 0, "flag": 1 if flagged else 0, "paid": 0}
    for uid, n, ts in pays:
        if uid in P:
            P[uid]["paid"] += n or 0
    real = [p for p in P.values() if not p["flag"]]
    # ---- overview and day by day
    series = []
    pay_day, payers_day, new_day = {}, {}, {}
    for uid, n, ts in pays:
        d = dayof(ts)
        pay_day[d] = pay_day.get(d, 0) + (n or 0)
        payers_day.setdefault(d, set()).add(uid)
    for p in real:
        if p["first"]:
            d = dayof(p["first"])
            new_day[d] = new_day.get(d, 0) + 1
    for d in range(d0, today + 1):
        series.append({"d": d, "date": time.strftime("%d.%m", time.gmtime(d * 86400)), "act": act.get(d, 0), "new": new_day.get(d, 0),
                       "stars": pay_day.get(d, 0), "payers": len(payers_day.get(d, ()))})
    seen_in = lambda sec: sum(1 for p in real if now - p["seen"] < sec)
    paid_period = sum(n or 0 for uid, n, ts in pays if ts >= t0)
    payers_period = len({uid for uid, n, ts in pays if ts >= t0})
    payers_all = len({uid for uid, n, ts in pays})
    summary = {"total": len(real), "new_day": sum(1 for p in real if now - p["first"] < 86400),
               "new_period": sum(1 for p in real if p["first"] >= t0), "dau": seen_in(86400), "wau": seen_in(7 * 86400),
               "active_period": act_any, "started": sum(1 for p in real if p["floor"] > 0),
               "stars_period": paid_period, "payers_period": payers_period, "payers_all": payers_all,
               "stars_all": sum(n or 0 for uid, n, ts in pays), "fights": len(fights)}
    # ---- where players are, and where those who left stopped
    floors = []
    for lo, hi, lab in FLOOR_BUCKETS:
        inb = [p for p in real if lo <= p["floor"] <= hi]
        floors.append({"lab": lab, "active": sum(1 for p in inb if now - p["seen"] < 3 * 86400),
                       "gone": sum(1 for p in inb if now - p["seen"] >= 7 * 86400 and p["first"] < now - 7 * 86400),
                       "all": len(inb)})
    # ---- walls: bosses and elite floors on the way up
    per = {}
    for uid, room, kind, win, tries, dur, cls, ts, qv, auto in fights:
        if kind == "n":
            continue
        r = per.setdefault(room, {"room": room, "kind": kind, "att": 0, "wins": 0, "players": set(), "cleared": set(), "tries": [], "first": 0, "dur": [], "qw": [], "ql": []})
        r["att"] += 1
        r["players"].add(uid)
        if win:
            if uid not in r["cleared"]:
                r["cleared"].add(uid)
                r["tries"].append(tries)
                if tries == 1:
                    r["first"] += 1
            r["wins"] += 1
            r["dur"].append(dur)
            r["qw"].append(qv)
        else:
            r["ql"].append(qv)
    walls = []
    for room in sorted(per):
        r = per[room]
        np_ = len(r["players"])
        if np_ == 0:
            continue
        walls.append({"room": room, "kind": r["kind"], "players": np_, "cleared": len(r["cleared"]), "att": r["att"],
                      "win": round(100 * r["wins"] / r["att"]), "tries": round(sum(r["tries"]) / len(r["tries"]), 1) if r["tries"] else None,
                      "first": round(100 * r["first"] / len(r["cleared"])) if r["cleared"] else None,
                      "stuck": np_ - len(r["cleared"]), "dur": round(_median(r["dur"])) if r["dur"] else None,
                      "qw": round(sum(r["qw"]) / len(r["qw"]) / 10, 1) if r["qw"] else None,
                      "ql": round(sum(r["ql"]) / len(r["ql"]) / 10, 1) if r["ql"] else None})
    # the hardest floors: most losses per player who came there (any kind, at least 3 players)
    lossy = {}
    for uid, room, kind, win, tries, dur, cls, ts, qv, auto in fights:
        x = lossy.setdefault(room, [kind, set(), 0])
        x[1].add(uid)
        x[2] += 0 if win else 1
    hardest = sorted(({"room": r, "kind": v[0], "players": len(v[1]), "loss": round(v[2] / len(v[1]), 1)} for r, v in lossy.items() if len(v[1]) >= 3),
                     key=lambda x: -x["loss"])[:12]
    # ---- classes
    cl = {}
    for p in real:
        if not p["cls"]:
            continue
        c = cl.setdefault(p["cls"], {"cls": p["cls"], "ru": CLS_RU.get(p["cls"], p["cls"]), "players": 0, "active": 0, "floors": [], "band": {b[2]: [0, 0] for b in BANDS},
                                     "bw": 0, "ba": 0, "nw": 0, "na": 0, "btries": []})
        c["players"] += 1
        c["active"] += 1 if now - p["seen"] < 7 * 86400 else 0
        c["floors"].append(p["floor"])
    for uid, room, kind, win, tries, dur, cls, ts, qv, auto in fights:
        c = cl.get(cls)
        if not c:
            continue
        if kind == "b":
            c["ba"] += 1
            c["bw"] += win
            if win:
                c["btries"].append(tries)
            for lo, hi, lab in BANDS:
                if lo <= room <= hi:
                    c["band"][lab][0] += win
                    c["band"][lab][1] += 1
        else:
            c["na"] += 1
            c["nw"] += win
    classes = []
    for c in sorted(cl.values(), key=lambda c: -c["players"]):
        classes.append({"cls": c["cls"], "ru": c["ru"], "players": c["players"], "active": c["active"],
                        "floor_med": round(_median(c["floors"])), "floor_max": max(c["floors"] or [0]),
                        "boss_win": round(100 * c["bw"] / c["ba"]) if c["ba"] else None, "boss_att": c["ba"],
                        "boss_tries": round(sum(c["btries"]) / len(c["btries"]), 1) if c["btries"] else None,
                        "norm_win": round(100 * c["nw"] / c["na"]) if c["na"] else None,
                        "band": {k: (round(100 * v[0] / v[1]) if v[1] >= 5 else None) for k, v in c["band"].items()}})
    # ---- stars: what they buy, and whether right after losing
    losses = {}
    for uid, room, kind, win, tries, dur, cls, ts, qv, auto in fights:
        if not win:
            losses.setdefault(uid, []).append(ts)
    buys = {}
    after_loss = 0
    for uid, what, n, ts in spend:
        key = what.split(":")[0]
        b = buys.setdefault(key, {"what": key, "ru": SPEND_RU.get(key, key), "stars": 0, "times": 0, "people": set()})
        b["stars"] += n or 0
        b["times"] += 1
        b["people"].add(uid)
        if any(0 <= ts - t <= 600 for t in losses.get(uid, ())):
            after_loss += 1
    spend_list = sorted(({"what": b["what"], "ru": b["ru"], "stars": b["stars"], "times": b["times"], "people": len(b["people"])} for b in buys.values()),
                        key=lambda x: -x["stars"])
    payer_floor = [p["floor"] for p in real if p["paid"] > 0]
    stars = {"spend": spend_list, "after_loss": round(100 * after_loss / len(spend)) if spend else None, "buys": len(spend),
             "payer_floor_med": round(_median(payer_floor)) if payer_floor else None,
             "conv": round(100 * payers_period / act_any, 1) if act_any else None}
    # ---- people: the most recently seen first
    people = sorted(({"name": p["name"], "un": p["un"], "cls": CLS_RU.get(p["cls"], p["cls"]), "floor": p["floor"], "level": p["level"],
                      "seen": int(p["seen"]), "first": int(p["first"]), "paid": p["paid"], "flag": p["flag"]} for p in P.values()),
                    key=lambda x: -x["seen"])[:500]
    return 200, {"ok": True, "days": days, "now": int(now), "tz": AC_TZ_S, "summary": summary, "series": series, "floors": floors,
                 "walls": walls, "hardest": hardest, "classes": classes, "stars": stars, "people": people}

STATS_PAGE = r"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Статистика еБашни</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{--bg:#0f0c17;--card:#1a1526;--card2:#221b31;--line:#2e2540;--tx:#ece6f5;--mut:#9a90ad;--gold:#f2c14e;--good:#5fd38a;--bad:#ff6b6b;--warn:#ffb347;--blue:#6ab0ff;--violet:#b48cff}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
body{padding:12px 12px calc(24px + env(safe-area-inset-bottom))}
h1{font-size:18px;margin:2px 0 10px;display:flex;align-items:center;gap:8px}h1 small{color:var(--mut);font-weight:400;font-size:12px;margin-left:auto}
h2{font-size:15px;margin:0 0 4px}.sub{color:var(--mut);font-size:12px;margin:0 0 10px}
.bar{display:flex;gap:6px;overflow-x:auto;margin:0 -12px 10px;padding:0 12px;scrollbar-width:none}.bar::-webkit-scrollbar{display:none}
.chip{flex:none;border:1px solid var(--line);background:var(--card);color:var(--tx);border-radius:16px;padding:6px 12px;font:inherit;font-size:13px}
.chip.on{background:var(--gold);color:#1a1300;border-color:var(--gold);font-weight:600}
.per .chip{padding:4px 10px;font-size:12px}.tabs{flex-wrap:wrap;overflow:visible}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px}
.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px}@media(min-width:560px){.kpis{grid-template-columns:repeat(3,1fr)}}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}.kpi b{display:block;font-size:22px;line-height:1.1;font-variant-numeric:tabular-nums}.kpi span{color:var(--mut);font-size:12px}
.kpi i{font-style:normal;font-size:12px;color:var(--mut)}
.note{background:var(--card2);border-left:3px solid var(--gold);border-radius:6px;padding:8px 10px;margin:8px 0 0;font-size:13px}
.note.bad{border-color:var(--bad)}.note.good{border-color:var(--good)}
svg{display:block;width:100%;height:auto}svg text{font:10px -apple-system,Roboto,sans-serif;fill:var(--mut)}
.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--mut);margin-top:6px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.hb{display:grid;grid-template-columns:84px 1fr 56px;align-items:center;gap:8px;margin:5px 0;font-size:12px}
.hb .lab{color:var(--mut);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hb .v{font-variant-numeric:tabular-nums;color:var(--tx)}
.track{height:14px;background:var(--card2);border-radius:4px;display:flex;overflow:hidden}.track>div{height:100%}
table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}th{color:var(--mut);font-weight:500;text-align:right;padding:4px 4px 6px;border-bottom:1px solid var(--line);white-space:nowrap}
td{text-align:right;padding:6px 4px;border-bottom:1px solid var(--line);white-space:nowrap}th:first-child,td:first-child{text-align:left}tr:last-child td{border-bottom:0}
.tw{overflow-x:auto;margin:0 -4px}
.pill{display:inline-block;min-width:38px;text-align:center;border-radius:5px;padding:1px 5px;font-weight:600}
.k-b{color:var(--bad)}.k-e{color:var(--violet)}
.tag{display:inline-block;font-size:10px;border-radius:4px;padding:0 4px;margin-left:4px;vertical-align:1px}.tag.b{background:#4a1f24;color:#ff9b9b}.tag.e{background:#2f2448;color:#cbb2ff}
input[type=search]{width:100%;background:var(--card2);border:1px solid var(--line);color:var(--tx);border-radius:10px;padding:8px 10px;font:inherit;margin-bottom:8px}
.ppl{display:flex;flex-direction:column}.pp{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:8px 2px;border-bottom:1px solid var(--line)}
.pp .n{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pp .m{color:var(--mut);font-size:12px}.pp .r{text-align:right;font-variant-numeric:tabular-nums}
.empty{color:var(--mut);text-align:center;padding:18px 6px}
.err{color:var(--bad);text-align:center;padding:30px 10px}
.load{color:var(--mut);text-align:center;padding:40px 10px}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:1px}
</style></head><body>
<h1>📊 Статистика <small id="upd"></small></h1>
<div class="bar per" id="per"></div>
<div class="bar tabs" id="tabs"></div>
<div id="v"><div class="load">Загружаем…</div></div>
<script>
const W=window.Telegram&&Telegram.WebApp;try{W.ready();W.expand();W.setHeaderColor&&W.setHeaderColor('#0f0c17');W.setBackgroundColor&&W.setBackgroundColor('#0f0c17');}catch(e){}
const $=id=>document.getElementById(id),esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=n=>n==null?'—':Number(n).toLocaleString('ru-RU');
let D=null,days=30,tab='over',q='';
try{days=+localStorage.getItem('st.days')||30;tab=localStorage.getItem('st.tab')||'over';}catch(e){}
const TABS=[['over','Обзор'],['walls','Где застревают'],['cls','Классы'],['stars','Звёзды'],['ppl','Игроки']];
function chips(){
  $('per').innerHTML=[7,30,90].map(d=>`<button class="chip${d===days?' on':''}" data-d="${d}">${d} дней</button>`).join('');
  $('tabs').innerHTML=TABS.map(([k,l])=>`<button class="chip${k===tab?' on':''}" data-t="${k}">${l}</button>`).join('');}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.d){days=+b.dataset.d;try{localStorage.setItem('st.days',days)}catch(x){}chips();load();}
  if(b.dataset.t){tab=b.dataset.t;try{localStorage.setItem('st.tab',tab)}catch(x){}chips();draw();}});
async function load(){
  if(!W||!W.initData){$('v').innerHTML='<div class="err">Открой страницу кнопкой «Открыть статистику» в боте — так она знает, что это ты.</div>';return;}
  $('v').innerHTML='<div class="load">Загружаем…</div>';
  try{const r=await fetch('/api/admin/dash?days='+days,{headers:{'X-Init-Data':W.initData}});
    if(r.status===403){$('v').innerHTML='<div class="err">Эта страница только для владельца игры.</div>';return;}
    if(!r.ok)throw 0;D=await r.json();$('upd').textContent='обновлено '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});draw();}
  catch(e){$('v').innerHTML='<div class="err">Не удалось загрузить. Потяни вниз или открой ещё раз.</div>';}}
function draw(){if(!D)return;const f={over,walls,cls,stars,ppl}[tab]||over;$('v').innerHTML=f();if(tab==='ppl'){const i=$('q');i.value=q;i.oninput=()=>{q=i.value;$('pl').innerHTML=pplRows();};}}
/* ---- small charts ---- */
function cols(series,keys,colors,h=150,labelEvery){
  const n=series.length,Wd=340,pad=22,bw=(Wd-pad)/n,max=Math.max(1,...series.map(s=>Math.max(...keys.map(k=>s[k]||0))));
  const step=niceStep(max),top=Math.ceil(max/step)*step;let g='';
  for(let v=0;v<=top;v+=step){const y=h-14-(h-24)*v/top;g+=`<line x1="${pad}" x2="${Wd}" y1="${y}" y2="${y}" stroke="#2e2540" stroke-width="1"/><text x="${pad-4}" y="${y+3}" text-anchor="end">${v}</text>`;}
  const per=keys.length,inner=bw*0.78/per;
  series.forEach((s,i)=>{keys.forEach((k,j)=>{const v=s[k]||0,bh=(h-24)*v/top,x=pad+i*bw+bw*0.11+j*inner,y=h-14-bh;
    if(v>0)g+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1,inner-0.6).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${colors[j]}"/>`;});
    const le=labelEvery||Math.ceil(n/7);if((i%le===0&&i<n-le/2)||i===n-1)g+=`<text x="${i===n-1?Wd:pad+i*bw+bw/2}" y="${h-2}" text-anchor="${i===n-1?'end':'middle'}">${s.date}</text>`;});
  return `<svg viewBox="0 0 ${Wd} ${h}">${g}</svg>`;}
function niceStep(m){const r=m/4,p=Math.pow(10,Math.floor(Math.log10(r||1))),k=r/p;return Math.max(1,(k<=1?1:k<=2?2:k<=5?5:10)*p);}
function hbars(rows){const max=Math.max(1,...rows.map(r=>r.parts.reduce((a,p)=>a+p.v,0)));
  return rows.map(r=>{const tot=r.parts.reduce((a,p)=>a+p.v,0);return `<div class="hb"><span class="lab">${esc(r.lab)}</span><div class="track">${r.parts.map(p=>p.v?`<div style="width:${100*p.v/max}%;background:${p.c}"></div>`:'').join('')}</div><span class="v">${r.txt!=null?r.txt:fmt(tot)}</span></div>`;}).join('');}
const leg=a=>`<div class="legend">${a.map(([c,t])=>`<span><i style="background:${c}"></i>${t}</span>`).join('')}</div>`;
const tone=(v,good,bad,rev)=>{if(v==null)return '';const g=rev?v<=good:v>=good,b=rev?v>=bad:v<=bad;return g?'background:#1d3b2a;color:#7fe0a3':b?'background:#4a1f24;color:#ff9b9b':'background:#3d3220;color:#ffd27a';};
const ago=t=>{if(!t)return '—';const s=D.now-t;return s<3600?Math.max(1,Math.round(s/60))+' мин назад':s<86400?Math.round(s/3600)+' ч назад':Math.round(s/86400)+' дн назад';};
const kpi=(v,l,x)=>`<div class="kpi"><b>${v}</b><span>${l}</span>${x?`<br><i>${x}</i>`:''}</div>`;
/* ---- tabs ---- */
function over(){const S=D.summary,se=D.series;
  const fl=D.floors.filter(r=>r.lab!=='0'||r.all);const worst=[...D.floors].filter(r=>r.lab!=='0').sort((a,b)=>b.gone-a.gone)[0];
  const lastAct=se.slice(-7).reduce((a,s)=>a+s.act,0),prevAct=se.slice(-14,-7).reduce((a,s)=>a+s.act,0);
  return `<div class="kpis">
    ${kpi(fmt(S.total),'игроков всего',`начали играть: ${fmt(S.started)}`)}
    ${kpi(fmt(S.new_period),'новых за '+D.days+' дн',`за сутки: ${fmt(S.new_day)}`)}
    ${kpi(fmt(S.dau),'заходили за сутки',`за неделю: ${fmt(S.wau)}`)}
    ${kpi(fmt(S.stars_period)+' ★','звёзд за '+D.days+' дн',`всего: ${fmt(S.stars_all)} ★`)}
    ${kpi(fmt(S.payers_period),'платили за '+D.days+' дн',`за всё время: ${fmt(S.payers_all)}`)}
    ${kpi(S.active_period?(Math.round(1000*S.payers_period/S.active_period)/10+'%'):'—','платящих среди активных','')}
  </div>
  <div class="card"><h2>Игроки по дням</h2><p class="sub">Сколько человек заходило и сколько пришло новых. Заходы считаются с этого обновления.</p>
    ${cols(se,['act','new'],['#6ab0ff','#f2c14e'])}${leg([['#6ab0ff','заходили'],['#f2c14e','новые']])}
    ${prevAct&&lastAct?`<div class="note ${lastAct>=prevAct?'good':'bad'}">За последние 7 дней заходов ${lastAct>=prevAct?'больше':'меньше'}, чем неделей раньше: ${fmt(lastAct)} против ${fmt(prevAct)}.</div>`:''}</div>
  <div class="card"><h2>Звёзды по дням</h2><p class="sub">Сколько звёзд купили (без возвратов).</p>${cols(se,['stars'],['#f2c14e'])}</div>
  <div class="card"><h2>На каких этажах игроки</h2><p class="sub">По самому высокому пройденному этажу. Зелёным — заходили за 3 дня, красным — не заходят неделю и дольше.</p>
    ${hbars(fl.map(r=>({lab:r.lab,parts:[{v:r.active,c:'#5fd38a'},{v:r.all-r.active-r.gone,c:'#4b4160'},{v:r.gone,c:'#ff6b6b'}],txt:fmt(r.all)})))}
    ${leg([['#5fd38a','играют'],['#4b4160','иногда'],['#ff6b6b','ушли']])}
    ${worst&&worst.gone?`<div class="note bad">Больше всего ушедших на этажах <b>${esc(worst.lab)}</b>: ${fmt(worst.gone)} чел.</div>`:''}</div>`;}
function walls(){const W2=D.walls.filter(w=>w.kind==='b'),E=D.walls.filter(w=>w.kind==='e'),H=D.hardest;
  if(!D.walls.length&&!H.length)return `<div class="card empty">Данные о боях начнут копиться после обновления игры. Загляни через день-два.</div>`;
  const row=w=>`<tr><td><b>${w.room}</b></td><td>${fmt(w.players)}</td><td>${fmt(w.cleared)}</td><td><span class="pill" style="${tone(w.stuck/w.players*100,15,40,1)}">${fmt(w.stuck)}</span></td><td><span class="pill" style="${tone(w.first,60,30)}">${w.first==null?'—':w.first+'%'}</span></td><td><span class="pill" style="${tone(w.tries,1.6,3,1)}">${w.tries==null?'—':String(w.tries).replace('.',',')}</span></td><td>${w.dur==null?'—':w.dur+'с'}</td></tr>`;
  const tbl=(rows,t)=>rows.length?`<div class="tw"><table><tr><th>Этаж</th><th>Дошли</th><th>Прошли</th><th>Застряли</th><th>С 1-й</th><th>Попыток</th><th>Бой</th></tr>${rows.map(row).join('')}</table></div>`:`<div class="empty">${t}</div>`;
  const top=[...W2].filter(w=>w.players>=3).sort((a,b)=>(b.stuck/b.players)-(a.stuck/a.players))[0];
  return `<div class="card"><h2>Самые трудные этажи</h2><p class="sub">Сколько поражений в среднем приходится на одного игрока, который туда дошёл (от 3 игроков).</p>
    ${H.length?hbars(H.map(h=>({lab:h.room+(h.kind==='b'?' 👑':h.kind==='e'?' ⚔':''),parts:[{v:h.loss,c:h.kind==='b'?'#ff6b6b':h.kind==='e'?'#b48cff':'#6ab0ff'}],txt:String(h.loss).replace('.',',')}))):'<div class="empty">Пока мало данных.</div>'}
    ${leg([['#ff6b6b','босс 👑'],['#b48cff','элита ⚔'],['#6ab0ff','обычный']])}</div>
  <div class="card"><h2>Боссы этажей</h2><p class="sub">Только первые прохождения. «Застряли» — дошли, но ещё не прошли. «Попыток» — сколько боёв нужно в среднем до победы.</p>
    ${tbl(W2,'Пока никто не дрался с боссом за этот период.')}
    ${top&&top.stuck?`<div class="note bad">Главная стена — босс <b>${top.room}</b> этажа: застряли ${fmt(top.stuck)} из ${fmt(top.players)}.</div>`:''}</div>
  <div class="card"><h2>Элитные этажи</h2>${tbl(E,'Пока нет данных.')}</div>`;}
function cls(){const C=D.classes;if(!C.length)return '<div class="card empty">Нет данных.</div>';
  const bands=Object.keys(C[0].band);
  const best=[...C].filter(c=>c.boss_att>=20).sort((a,b)=>b.boss_win-a.boss_win),hi=best[0],lo=best[best.length-1];
  return `<div class="card"><h2>Классы</h2><p class="sub">Сколько играют и как далеко зашли. «Медиана» — этаж, до которого дошла половина игроков класса.</p>
    ${hbars(C.map(c=>({lab:c.ru,parts:[{v:c.active,c:'#5fd38a'},{v:c.players-c.active,c:'#4b4160'}],txt:fmt(c.players)})))}${leg([['#5fd38a','заходили за неделю'],['#4b4160','остальные']])}
    <div class="tw" style="margin-top:10px"><table><tr><th>Класс</th><th>Медиана</th><th>Макс.</th><th>Обычные</th><th>Боссы</th><th>Попыток</th></tr>
    ${C.map(c=>`<tr><td>${esc(c.ru)}</td><td>${fmt(c.floor_med)}</td><td>${fmt(c.floor_max)}</td><td>${c.norm_win==null?'—':c.norm_win+'%'}</td><td><span class="pill" style="${tone(c.boss_win,55,35)}">${c.boss_win==null?'—':c.boss_win+'%'}</span></td><td>${c.boss_tries==null?'—':String(c.boss_tries).replace('.',',')}</td></tr>`).join('')}</table></div></div>
  <div class="card"><h2>Победы над боссами по высоте</h2><p class="sub">Доля выигранных боёв с боссами на новых этажах. Пусто — меньше 5 боёв.</p>
    <div class="tw"><table><tr><th>Класс</th>${bands.map(b=>`<th>${b}</th>`).join('')}</tr>
    ${C.map(c=>`<tr><td>${esc(c.ru)}</td>${bands.map(b=>{const v=c.band[b];return `<td><span class="pill" style="${tone(v,55,35)}">${v==null?'—':v+'%'}</span></td>`;}).join('')}</tr>`).join('')}</table></div>
    ${hi&&lo&&hi!==lo&&hi.boss_win-lo.boss_win>=15?`<div class="note">Разрыв по боссам: ${esc(hi.ru)} ${hi.boss_win}% против ${esc(lo.ru)} ${lo.boss_win}%.</div>`:''}</div>`;}
function stars(){const St=D.stars,S=D.summary,sp=St.spend;
  return `<div class="kpis">
    ${kpi(fmt(S.stars_period)+' ★','куплено за '+D.days+' дн','')}
    ${kpi(fmt(S.payers_period),'платили за '+D.days+' дн','')}
    ${kpi(St.conv==null?'—':String(St.conv).replace('.',',')+'%','платят из активных','')}
    ${kpi(St.after_loss==null?'—':St.after_loss+'%','трат сразу после поражения','в течение 10 минут')}
    ${kpi(St.payer_floor_med==null?'—':fmt(St.payer_floor_med),'медианный этаж платящих','')}
    ${kpi(fmt(St.buys),'покупок за '+D.days+' дн','')}
  </div>
  <div class="card"><h2>На что тратят звёзды</h2><p class="sub">Сколько звёзд ушло на каждую вещь за период и сколько человек покупали.</p>
    ${sp.length?hbars(sp.map(x=>({lab:x.ru.length>12?x.ru.slice(0,11)+"…":x.ru,parts:[{v:x.stars,c:'#f2c14e'}],txt:fmt(x.stars)+' ★'}))):'<div class="empty">За этот период трат не было.</div>'}
    ${sp.length?`<div class="tw" style="margin-top:8px"><table><tr><th>Что</th><th>Звёзд</th><th>Покупок</th><th>Людей</th></tr>${sp.map(x=>`<tr><td>${esc(x.ru)}</td><td>${fmt(x.stars)}</td><td>${fmt(x.times)}</td><td>${fmt(x.people)}</td></tr>`).join('')}</table></div>`:''}</div>
  <div class="card"><h2>Платящие по дням</h2>${cols(D.series,['payers'],['#b48cff'])}</div>`;}
function pplRows(){const s=q.trim().toLowerCase();const L=D.people.filter(p=>!s||(p.name+' '+p.un+' '+p.cls).toLowerCase().includes(s)).slice(0,200);
  if(!L.length)return '<div class="empty">Никого не нашли.</div>';
  return L.map(p=>{const on=D.now-p.seen<86400*3;return `<div class="pp"><div class="n"><span class="dot" style="background:${on?'#5fd38a':'#4b4160'}"></span>${esc(p.name)}${p.un?` <span class="m">@${esc(p.un)}</span>`:''}${p.flag?' <span class="tag b">флаг</span>':''}</div>
    <div class="r"><b>${fmt(p.floor)}</b> <span class="m">эт.</span></div><div class="m">${esc(p.cls||'без класса')} · ${p.level} ур. · ${ago(p.seen)}</div><div class="r m">${p.paid?`<span style="color:#f2c14e">${fmt(p.paid)} ★</span>`:''}</div></div>`;}).join('');}
function ppl(){return `<div class="card"><input id="q" type="search" placeholder="Поиск по имени или классу"><div class="ppl" id="pl">${pplRows()}</div></div>`;}
chips();load();
</script>
</body></html>
"""

# ---------------------------------------------------------------- bot: /start opens the game, inline "raid" invites a group
def tg(method, **params):
    req = urllib.request.Request(f"https://api.telegram.org/bot{BOT_TOKEN}/{method}",
                                 data=json.dumps(params).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())

def app_link(param=""):
    return f"https://t.me/{BOT_USERNAME}/{APP_NAME}" + (f"?startapp={param}" if param else "")

def answer_inline(q):
    """The game's "Позвать группу" button opens this in a group: an invitation into the game.
    The chat's boss itself is called only by the chat's creator or an admin with /boss."""
    tg("answerInlineQuery", inline_query_id=q["id"], cache_time=60, is_personal=False, results=[{
        "type": "article", "id": "invite", "title": "Позвать чат в еБашню",
        "description": "Приглашение в игру; босса чата призывает админ командой /boss",
        "input_message_content": {"message_text":
            "Зову в еБашню — пиксельную башню, где герой сам дерётся, а ты одеваешь его и лезешь всё выше!\n\n"
            f"Админ чата может призвать сюда общего босса командой /boss@{BOT_USERNAME} — тогда весь чат бьёт его наперегонки."},
        "reply_markup": {"inline_keyboard": [[{"text": "Зайти в еБашню!", "url": app_link()}]]},
    }])

CLS_RU = {"knight": "Рыцарь", "gunner": "Стрелок", "necro": "Некромант", "assassin": "Ассасин", "gladiator": "Гладиатор", "mage": "Маг",
          "samurai": "Самурай", "duelist": "Дуэлянт", "berserker": "Берсерк", "ranger": "Следопыт", "paladin": "Паладин", "monk": "Монах",
          "shaman": "Шаман", "orc": "Орк", "vampire": "Вампир"}

def stats_command(msg):
    """/статистика (or /stats) in a private chat with the bot, owner only: how many players and who is where.
    "/статистика все" lists everybody, otherwise the 50 seen most recently."""
    chat = msg["chat"]["id"]
    if (msg.get("from") or {}).get("id") not in ADMIN_IDS:
        return
    full = "все" in (msg.get("text") or "").lower() or "all" in (msg.get("text") or "").lower()
    now = time.time()
    with db_lock:
        rows = db.execute("""SELECT id, name, username, cls, room, level, seen, updated FROM players
                             ORDER BY COALESCE(NULLIF(seen, 0), updated, 0) DESC""").fetchall()
        lv = {}
        for uid, data in db.execute("SELECT uid, data FROM saves"):
            try:
                d = json.loads(data)
                lv[uid] = (int(d.get("level") or 0), int(d.get("maxCleared") or 0), str(d.get("cls") or ""))
            except (ValueError, TypeError):
                pass
        nft_ln = nft_stats_line()
    def last(r):
        return r[6] or r[7] or 0
    total = len(rows)
    d1 = sum(1 for r in rows if now - last(r) < 86400)
    d7 = sum(1 for r in rows if now - last(r) < 7 * 86400)
    played = sum(1 for r in rows if (r[4] or 0) > 0 or (lv.get(r[0], (0, 0))[1] > 0))
    when = lambda t: time.strftime("%d.%m %H:%M", time.gmtime(t + AC_TZ * 3600)) if t else "—"
    if not full and WEBAPP_URL:
        # v193: a short line and a button; everything else lives on the statistics page
        return tg("sendMessage", chat_id=chat, parse_mode="HTML",
                  text=(f"📊 <b>Статистика</b>\nИгроков: <b>{total}</b> · за сутки: <b>{d1}</b> · за неделю: <b>{d7}</b>\n"
                        f"Графики, стены, классы и звёзды — на странице."),
                  reply_markup={"inline_keyboard": [[{"text": "📊 Открыть статистику", "web_app": {"url": WEBAPP_URL + "stats"}}],
                                                    [{"text": "Список текстом", "callback_data": "stats_all"}]]})
    head = (f"📊 Статистика башни\n\nВсего игроков: {total}\nХоть раз прошли этаж: {played}\n"
            f"Заходили за сутки: {d1}\nЗаходили за неделю: {d7}\n{nft_ln}\n\n"
            + ("Все игроки" if full else f"Последние {min(50, total)} по времени входа") + " (этаж · ур. · вход):")
    lines = []
    for r in (rows if full else rows[:50]):
        uid, name, un, cls, room, level, seen, upd = r
        sl, sf, sc = lv.get(uid, (0, 0, ""))
        who = html_esc(name or "Игрок") + (f" @{html_esc(un)}" if un else "")
        cl = CLS_RU.get(sc or cls or "", "")
        lines.append(f"{who}{' · ' + cl if cl else ''} — эт. {max(room or 0, sf)} · ур. {max(level or 0, sl) or 1} · {when(seen or upd)}")
    if not full and total > 50:
        lines.append("\nВесь список: /статистика все")
    # Telegram takes up to 4096 characters per message
    chunks, cur = [], head
    for ln in lines:
        if len(cur) + len(ln) + 1 > 3900:
            chunks.append(cur)
            cur = ""
        cur += "\n" + ln
    chunks.append(cur)
    for c in chunks:
        tg("sendMessage", chat_id=chat, text=c, parse_mode="HTML", disable_web_page_preview=True)

# ---------- /рассылка: the owner writes once, every player who allowed the bot gets it with a button into the game ----------
BC_BUTTON = "Зайти в еБашню!"
bc_running = threading.Event()

def tg_try(method, **params):
    """Like tg(), but Telegram's refusals come back as a dict instead of an exception (403 blocked, 429 slow down, 400 bad)."""
    try:
        return tg(method, **params)
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read())
        except Exception:
            return {"ok": False, "error_code": e.code, "description": str(e)}
    except Exception as e:
        return {"ok": False, "error_code": 0, "description": str(e)}

def bc_markup():
    return {"inline_keyboard": [[{"text": BC_BUTTON, "web_app": {"url": WEBAPP_URL}}]]} if WEBAPP_URL else \
           {"inline_keyboard": [[{"text": BC_BUTTON, "url": app_link()}]]}

def bc_send(job, chat_id):
    """One copy of the post: a reply-to post is copied as it is (photo, video, formatting), plain text keeps its formatting."""
    if job.get("copy"):
        extra = {"caption": job["caption"], "caption_entities": job.get("caption_entities") or []} if "caption" in job else {}
        return tg_try("copyMessage", chat_id=chat_id, from_chat_id=job["from"], message_id=job["copy"], reply_markup=bc_markup(), **extra)
    return tg_try("sendMessage", chat_id=chat_id, text=job["text"], entities=job.get("entities") or [],
                  disable_web_page_preview=True, reply_markup=bc_markup())

def bc_targets():
    with db_lock:
        return [r[0] for r in db.execute("SELECT id FROM players WHERE can_pm=1 ORDER BY id").fetchall()]

def terms_command(msg, cmd):
    """/terms: the rules page; /paysupport: what to do when a purchase went wrong (required for bots that take Stars)."""
    chat_id, url = msg["chat"]["id"], terms_url()
    sup = SUPPORT_URL
    rows = []
    if url:
        rows.append([{"text": "Условия и конфиденциальность", "url": url}])
    if sup:
        rows.append([{"text": "Написать в поддержку", "url": sup}])
    if cmd == "/terms":
        text = ("<b>еБашня · условия</b>\n\n"
                "Игра 18+: в ней есть мат и грубый юмор.\n"
                "Всё в игре, включая звёзды на игровом балансе, — внутриигровые ценности без денежной стоимости.\n"
                "Читы и мультиаккаунты запрещены: за них откатываем прогресс или блокируем.\n"
                "Храним только твой Telegram ID, имя и прогресс — для сохранений, рейтинга и дуэлей. Никому не передаём.\n\n"
                "Полный текст — по кнопке ниже. Играя, ты принимаешь эти условия.")
    else:
        text = ("<b>Помощь с оплатой</b>\n\n"
                "Оплатил звёздами, а покупка не пришла за час? Напиши нам и приложи:\n"
                "• дату и время оплаты\n• сумму в звёздах\n• свой ник в игре\n\n"
                "Проверим и начислим покупку или вернём звёзды через Telegram. Уже полученные и потраченные покупки не возвращаются.\n"
                "Поддержка Telegram и магазинов приложений по этим покупкам не помогает — только мы."
                + ("" if sup else "\n\nПиши прямо сюда, в этот чат."))
    tg("sendMessage", chat_id=chat_id, text=text, parse_mode="HTML", disable_web_page_preview=True,
       **({"reply_markup": {"inline_keyboard": rows}} if rows else {}))

def broadcast_command(msg):
    """/рассылка (or /broadcast), owner only, in the bot's private chat.
       «/рассылка текст» sends that text; a reply «/рассылка» to any message (photo, video, formatted text) sends that message.
       The bot first shows exactly how it will look, then asks to confirm."""
    me = (msg.get("from") or {}).get("id")
    if me not in ADMIN_IDS:
        return
    chat = msg["chat"]["id"]
    media = not msg.get("text") and any(k in msg for k in ("photo", "video", "animation", "document", "audio", "voice", "video_note"))
    text = msg.get("text") or msg.get("caption") or ""
    cut = len(text.split()[0]) if text.split() else 0
    body = text[cut:]
    lead = len(body) - len(body.lstrip())
    body = body.strip()
    rep_msg = msg.get("reply_to_message")
    # Telegram counts formatting offsets in UTF-16 units
    u16 = lambda x: len(x.encode("utf-16-le")) // 2
    shift = u16(text[:cut + lead])
    def shifted(lst):
        out = []
        for e in lst or []:
            if e.get("type") == "bot_command" and e.get("offset") == 0:
                continue
            e = dict(e)
            e["offset"] -= shift
            if e["offset"] >= 0:
                out.append(e)
        return out
    if media:
        # a photo or video sent with the caption «/рассылка текст»: that file goes out, the caption without the command
        job = {"copy": msg["message_id"], "from": chat, "caption": body, "caption_entities": shifted(msg.get("caption_entities"))}
    elif rep_msg:
        job = {"copy": rep_msg["message_id"], "from": chat}
    elif body:
        ents = []
        for e in msg.get("entities") or []:
            if e.get("type") == "bot_command" and e.get("offset") == 0:
                continue
            e = dict(e)
            e["offset"] -= shift
            if e["offset"] >= 0:
                ents.append(e)
        job = {"text": body, "entities": ents}
    else:
        tg("sendMessage", chat_id=chat, parse_mode="HTML", text=
           "<b>Рассылка всем игрокам</b>\n\n"
           "• <code>/рассылка текст</code> — разослать текст (жирный, курсив и ссылки сохранятся)\n"
           "• фото, видео или гифка с подписью <code>/рассылка текст</code> — разошлю файл с этой подписью\n"
           "• или ответь командой <code>/рассылка</code> на любое своё сообщение — с картинкой, видео, чем угодно\n\n"
           f"Под каждым сообщением будет кнопка «{BC_BUTTON}». Сначала покажу, как это будет выглядеть, и спрошу подтверждение.")
        return
    if bc_running.is_set():
        tg("sendMessage", chat_id=chat, text="Предыдущая рассылка ещё идёт — дождись отчёта.")
        return
    n = len(bc_targets())
    tg("sendMessage", chat_id=chat, text="Вот так увидят игроки:")
    pv = bc_send(job, chat)
    if not pv.get("ok"):
        tg("sendMessage", chat_id=chat, text=f"Telegram не принял сообщение: {pv.get('description', '?')}")
        return
    key = "bc:" + hashlib.sha1(f"{chat}:{time.time()}".encode()).hexdigest()[:10]
    with db_lock:
        db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (key, json.dumps(job)))
        db.commit()
    tg("sendMessage", chat_id=chat, text=f"Отправить это {n} {plural_ru(n, 'игроку', 'игрокам', 'игрокам')}?\n"
       "(получат все, кто запускал бота и не заблокировал его)",
       reply_markup={"inline_keyboard": [[{"text": f"✅ Отправить всем ({n})", "callback_data": key + ":go"},
                                          {"text": "Отмена", "callback_data": key + ":no"}]]})

def plural_ru(n, one, few, many):
    n = abs(n) % 100
    return few if 2 <= n % 10 <= 4 and not 12 <= n <= 14 else one if n % 10 == 1 and n != 11 else many

def broadcast_callback(cq):
    me = (cq.get("from") or {}).get("id")
    data = cq.get("data") or ""
    m = cq.get("message") or {}
    if me not in ADMIN_IDS or not data.startswith("bc:"):
        tg_try("answerCallbackQuery", callback_query_id=cq["id"])
        return
    key, _, act = data.rpartition(":")
    with db_lock:
        row = db.execute("SELECT v FROM kv WHERE k=?", (key,)).fetchone()
        db.execute("DELETE FROM kv WHERE k=?", (key,))
        db.commit()
    chat, mid = m.get("chat", {}).get("id"), m.get("message_id")
    if not row:
        tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Эта рассылка уже отправлена или отменена")
        return
    if act != "go":
        tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Отменено")
        tg_try("editMessageText", chat_id=chat, message_id=mid, text="Рассылка отменена.")
        return
    if bc_running.is_set():
        tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Предыдущая рассылка ещё идёт")
        return
    tg_try("answerCallbackQuery", callback_query_id=cq["id"], text="Поехали")
    job = json.loads(row[0])
    bc_running.set()
    threading.Thread(target=broadcast_run, args=(job, chat, mid), daemon=True).start()

def broadcast_run(job, chat, mid):
    """About 20 messages a second (Telegram allows 30); those who blocked the bot are marked and skipped next time."""
    try:
        ids = bc_targets()
        ok = blocked = failed = 0
        t0 = time.time()
        tg_try("editMessageText", chat_id=chat, message_id=mid, text=f"Рассылка идёт: 0 из {len(ids)}…")
        for i, uid in enumerate(ids, 1):
            for _ in range(3):
                r = bc_send(job, uid)
                if r.get("ok"):
                    ok += 1
                    break
                code = r.get("error_code")
                if code == 429:
                    time.sleep(int((r.get("parameters") or {}).get("retry_after", 3)) + 1)
                    continue
                if code in (400, 403):
                    blocked += 1
                    with db_lock:
                        db.execute("UPDATE players SET can_pm=0 WHERE id=?", (uid,))
                        db.commit()
                else:
                    failed += 1
                break
            else:
                failed += 1
            time.sleep(0.05)
            if i % 200 == 0:
                tg_try("editMessageText", chat_id=chat, message_id=mid, text=f"Рассылка идёт: {i} из {len(ids)}…")
        took = int(time.time() - t0)
        tg_try("editMessageText", chat_id=chat, message_id=mid, text=
               f"Рассылка готова за {took // 60} мин {took % 60} с.\n"
               f"Доставлено: {ok}\nЗаблокировали бота или недоступны: {blocked}\nДругие ошибки: {failed}")
        log.info("broadcast: %s ok, %s blocked, %s failed", ok, blocked, failed)
    except Exception as e:
        log.warning("broadcast: %s", e)
        tg_try("sendMessage", chat_id=chat, text=f"Рассылка оборвалась: {e}")
    finally:
        bc_running.clear()

def bot_loop():
    global BOT_USERNAME
    if not WEBAPP_URL:
        log.warning("WEBAPP_URL is empty: the bot will not offer the game button")
    for _ in range(10):
        try:
            BOT_USERNAME = tg("getMe")["result"]["username"]
            break
        except Exception as e:
            log.warning("getMe: %s", e)
            time.sleep(5)
    log.info("bot @%s, Mini App link %s", BOT_USERNAME, app_link())
    try:
        tg("setChatMenuButton", menu_button={"type": "web_app", "text": "Играть", "web_app": {"url": WEBAPP_URL}})
    except Exception as e:
        log.warning("could not set the menu button: %s", e)
    # the «/» menu in private chats: Telegram asks every bot that takes Stars for /terms and /paysupport
    try:
        tg("setMyCommands", scope={"type": "all_private_chats"}, commands=[
            {"command": "start", "description": "Войти в башню"},
            {"command": "terms", "description": "Условия и конфиденциальность (18+)"},
            {"command": "paysupport", "description": "Помощь с оплатой звёздами"}])
    except Exception as e:
        log.warning("could not set private commands: %s", e)
    # the owners see their own commands in the «/» menu of their chat with the bot
    for a_id in ADMIN_IDS:
        try:
            tg("setMyCommands", scope={"type": "chat", "chat_id": a_id}, commands=[
                {"command": "start", "description": "Войти в башню"},
                {"command": "nft", "description": "NFT: кому что выпало, заявки, настройки"},
                {"command": "stats", "description": "Статистика игроков"},
                {"command": "broadcast", "description": "Рассылка всем игрокам"},
                {"command": "wipe", "description": "Сброс игрока"},
                {"command": "refund", "description": "Покупки звёзд и возврат"},
                {"command": "terms", "description": "Условия и конфиденциальность (18+)"}])
        except Exception as e:
            log.info("could not set owner commands for %s: %s", a_id, e)
    # the «/» menu in groups: admins see /boss there and a tap sends «/boss@bot», which always reaches this bot
    try:
        tg("setMyCommands", scope={"type": "all_chat_administrators"}, commands=[
            {"command": "boss", "description": "Призвать босса в чат"}])
    except Exception as e:
        log.warning("could not set group commands: %s", e)
    offset = 0
    while True:
        try:
            res = tg("getUpdates", offset=offset, timeout=30, allowed_updates=["message", "inline_query", "chosen_inline_result", "callback_query", "pre_checkout_query"])
            for upd in res.get("result", []):
                offset = upd["update_id"] + 1
                if upd.get("pre_checkout_query"):
                    try:
                        stars_precheckout(upd["pre_checkout_query"])
                    except Exception as e:
                        log.warning("pre-checkout: %s", e)
                    continue
                if (upd.get("message") or {}).get("successful_payment"):
                    try:
                        stars_paid(upd["message"])
                    except Exception as e:
                        log.warning("payment: %s", e)
                    continue
                cq = upd.get("callback_query")
                if cq:
                    try:
                        if (cq.get("data") or "").startswith("bs:"):
                            boss_callback(cq)
                            continue
                        if (cq.get("data") or "").startswith("wp:"):
                            wipe_callback(cq)
                            continue
                        if (cq.get("data") or "").startswith("nf:"):
                            nft_callback(cq)
                            continue
                        if (cq.get("data") or "").startswith("grm:"):
                            gr_mute_callback(cq)
                            continue
                        if (cq.get("data") or "") == "stats_all":
                            tg_try("answerCallbackQuery", callback_query_id=cq["id"])
                            m = cq.get("message") or {}
                            stats_command({"chat": m.get("chat") or {"id": cq["from"]["id"]}, "from": cq["from"], "text": "/статистика все"})
                            continue
                        broadcast_callback(cq)
                    except Exception as e:
                        log.warning("callback: %s", e)
                    continue
                cir = upd.get("chosen_inline_result")
                if cir:
                    rid, imid = str(cir.get("result_id", "")), cir.get("inline_message_id")
                    if rid.startswith("duel_") and imid:
                        with db_lock:
                            k = "dmsg:" + rid[5:]
                            old = db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
                            lst = (json.loads(old[0]) if old else [])[-9:] + [imid]
                            db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (k, json.dumps(lst)))
                            db.commit()
                    continue
                if upd.get("inline_query"):
                    try:
                        answer_inline(upd["inline_query"])
                    except Exception as e:
                        log.warning("inline answer: %s", e)
                    continue
                msg = upd.get("message") or {}
                if any((u.get("username") or "").lower() == (BOT_USERNAME or "").lower() for u in msg.get("new_chat_members") or []) \
                        and msg.get("chat", {}).get("type") in ("group", "supergroup"):
                    bot_joined(msg)
                    continue
                text = msg.get("text") or ""
                first = text.split()[0] if text.split() else ""
                if first.split("@")[0].lower() == "/boss" and ("@" not in first or first.split("@", 1)[1].lower() == (BOT_USERNAME or "").lower()) \
                        and msg.get("chat", {}).get("type") in ("group", "supergroup"):
                    try:
                        boss_command(msg)
                    except Exception as e:
                        log.warning("/boss: %s", e)
                    continue
                cmd = (text.split()[0] if text.split() else "").split("@")[0].lower()
                if not text and msg.get("caption"):
                    cap = msg["caption"].split()
                    if cap and cap[0].split("@")[0].lower() in ("/рассылка", "/broadcast"):
                        cmd = cap[0].split("@")[0].lower()
                if cmd in ("/рассылка", "/broadcast") and msg.get("chat", {}).get("type") == "private":
                    try:
                        broadcast_command(msg)
                    except Exception as e:
                        log.warning("/broadcast: %s", e)
                    continue
                if cmd in ("/сброс", "/wipe") and msg.get("chat", {}).get("type") == "private":
                    try:
                        wipe_command(msg)
                    except Exception as e:
                        log.warning("/wipe: %s", e)
                    continue
                if cmd in ("/refund", "/возврат") and msg.get("chat", {}).get("type") == "private":
                    try:
                        refund_command(msg)
                    except Exception as e:
                        log.warning("/refund: %s", e)
                    continue
                if cmd in ("/terms", "/paysupport", "/support") and msg.get("chat", {}).get("type") == "private":
                    try:
                        terms_command(msg, cmd)
                    except Exception as e:
                        log.warning("/terms: %s", e)
                    continue
                if cmd in ("/nft", "/нфт") and msg.get("chat", {}).get("type") == "private":
                    try:
                        nft_command(msg)
                    except Exception as e:
                        log.warning("/nft: %s", e)
                    continue
                if cmd in ("/статистика", "/stats") and msg.get("chat", {}).get("type") == "private":
                    try:
                        stats_command(msg)
                    except Exception as e:
                        log.warning("/stats: %s", e)
                    continue
                if text.startswith("/start") and msg.get("chat", {}).get("type") == "private" and msg.get("from"):
                    fr = msg["from"]
                    ensure_player(fr)
                    with db_lock:
                        db.execute("UPDATE players SET can_pm=1, notify=CASE WHEN notify_off=1 THEN notify ELSE 1 END WHERE id=?", (fr["id"],))
                        db.commit()
                if (msg.get("text") or "").startswith("/start") and msg.get("chat", {}).get("type") == "private":
                    tg("sendMessage", chat_id=msg["chat"]["id"],
                       text="Башня Emberspire ждёт. Выбери героя и поднимайся всё выше: на каждом десятом этаже элита, на каждом пятидесятом — босс.",
                       reply_markup={"inline_keyboard": [[{"text": "Войти в башню", "web_app": {"url": WEBAPP_URL}}]]})
        except Exception as e:
            log.warning("bot polling: %s", e)
            time.sleep(5)

def events_loop():
    """Events that ran out of time get their closing post."""
    while True:
        time.sleep(60)
        try:
            with db_lock:
                due = [r[0] for r in db.execute("SELECT ci FROM raid_events WHERE closed=0 AND ends<?", (time.time(),)).fetchall()]
            for ci in due:
                close_event(ci)
            season_close()
        except Exception as e:
            log.warning("events loop: %s", e)

def housekeeping_loop():
    while True:
        try:
            cards_cleanup()
            old = week_id() - 4
            with db_lock:
                db.execute("DELETE FROM raids WHERE week<? AND week>=0", (old,))
                db.execute("DELETE FROM raid_hits WHERE week<? AND week>=0", (old,))
                db.execute("DELETE FROM raid_tries WHERE day<?", (day_id() - 7,))
                db.execute("DELETE FROM raid_tries_c WHERE day<?", (day_id() - 7,))
                db.execute("DELETE FROM fight_log WHERE ts<?", (time.time() - 120 * 86400,))
                db.execute("DELETE FROM act WHERE day<?", (day_id() - 400,))
                db.commit()
        except Exception as e:
            log.warning("housekeeping: %s", e)
        time.sleep(6 * 3600)

if __name__ == "__main__":
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN is not set (see emberspire.env.example)")
    if os.environ.get("EMBER_NO_BOT") != "1":
        threading.Thread(target=bot_loop, daemon=True).start()
        threading.Thread(target=reminder_loop, daemon=True).start()
        threading.Thread(target=events_loop, daemon=True).start()
    threading.Thread(target=housekeeping_loop, daemon=True).start()
    def _br_warm():
        """v196: ask ourselves for the game page and its picture files, so the brotli copies are ready before the first player comes."""
        time.sleep(2)
        paths = ["/"] + ["/a/" + n for n in (os.listdir(os.path.join(PUBLIC, "a")) if os.path.isdir(os.path.join(PUBLIC, "a")) else []) if n.endswith(".js")]
        for _ in range(2):
            for pth in paths:
                try:
                    urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{PORT}{pth}", headers={"Accept-Encoding": "br"}), timeout=90).read()
                except Exception as e:
                    log.info("brotli warm %s: %s", pth, e)
            time.sleep(15)
    threading.Thread(target=_br_warm, daemon=True).start()
    threading.Thread(target=ac_loop, daemon=True).start()
    threading.Thread(target=ac_scan, daemon=True).start()
    if os.environ.get("EMBER_NO_BOT") != "1":
        threading.Thread(target=ac_digest_loop, daemon=True).start()
    log.info("Emberspire on 127.0.0.1:%s, game folder %s", PORT, PUBLIC)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
