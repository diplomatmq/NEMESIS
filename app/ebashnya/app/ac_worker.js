// Anti-cheat worker for the game server. It stays running and answers one JSON line per request line.
// It loads the game's own rules (the <script id="logic"> block of public/index.html) and reloads them when the page is replaced.
//   {"op":"check","save":{...}}                 -> {"issues":[{k,hard,msg}], "power":n, "level":n, "floor":n}
//   {"op":"canwin","save":{...},"room":n,"seeds":4} -> {"room":n,"wins":w,"tries":t}
const fs = require('fs'), path = require('path'), readline = require('readline');
const PAGE = path.join(__dirname, 'public', 'index.html');
let L = null, mtime = 0, MAXB = null;

function load() {
  const st = fs.statSync(PAGE);
  if (L && st.mtimeMs === mtime) return;
  const html = fs.readFileSync(PAGE, 'utf8');
  const m = /<script id="logic">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('logic not found');
  // judge claims by the older, gentler deep floors: a legit hero who climbed before they got harder must not look impossible
  globalThis.__LATE = { a: 0, h: 0 };
  L = new Function(m[1] + ';return Logic;')();
  mtime = st.mtimeMs;
  // the highest base value any template of a slot can give each stat (plain affixes count too)
  const AFF = { atk: 2, def: 2, hp: 8, crit: 2, cdmg: 8, spd: 3, acc: 3, mres: 4 };
  MAXB = {};
  for (const s of L.SLOTS) {
    const o = MAXB[s] = Object.assign({}, AFF);
    for (const t of L.TEMPLATES) if (t.slot === s) for (const src of [t.base || {}, t.opt || {}]) for (const k in src) o[k] = Math.max(o[k] || 0, src[k]);
  }
}

const flatF = il => 1 + 0.11 * (il - 1), pctF = il => 1 + 0.015 * (Math.min(il, 150) - 1);
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

/* The most a legal item of this level, colour and fusion depth can have in one stat.
   Best roll (+15%), then every fusion generation: +10 upgrades (×1.3 or a flat +10 scaled to the level) and the 3-item bonus (+18%),
   finally the last round of upgrades and 10% slack. Forged values are usually tens of times above this. */
function statMax(slot, k, ilvl, rar, fused) {
  const pct = !!(L.STAT_INFO[k] && L.STAT_INFO[k].pct);
  const b = (MAXB[slot] || {})[k] || 8, m = L.RARITIES[Math.max(0, Math.min(4, rar | 0))].mult;
  let v = (pct ? b * Math.pow(m, 0.6) * pctF(ilvl) : b * m * flatF(ilvl)) * 1.15;
  const up = x => (pct ? x + 4 * pctF(ilvl) : Math.max(x * 1.3, x + 11 * flatF(ilvl)));
  for (let g = 0; g < Math.min(fused | 0, 60); g++) v = up(v) * (pct ? 1.09 : 1.18);
  return up(v) * 1.1 + 2;
}

function check(sv) {
  const out = [], add = (k, hard, msg) => out.push({ k, hard: !!hard, msg });
  const level = num(sv.level, 1), floor = num(sv.maxCleared), room = num(sv.room, 1);
  const st = sv.st || {}, wins = num(st.wins), sk = sv.skills || {};
  if (!L.CLASSES[sv.cls]) add('cls', true, 'неизвестный класс');
  if (level < 1 || level > 5000 || level !== Math.floor(level)) add('level', true, `уровень ${level}`);
  // every floor is a won fight
  if (floor > wins + 1) add('wins', true, `этаж ${floor}, а побед всего ${wins}`);
  if (room > floor + 2) add('room', false, `стоит на этаже ${room}, рекорд ${floor}`);
  // one skill point per level, never more
  let spent = 0;
  for (const id in sk) {
    const v = num(sk[id]);
    if (v < 0 || v !== Math.floor(v)) { add('skill', true, `навык ${id} = ${v}`); continue; }
    spent += v;
    const d = L.SKILLS[id];
    if (d && d.max && v > d.max + 1) add('skillmax', false, `навык ${id}: ${v} из ${d.max}`);
  }
  if (spent > level) add('points', true, `потрачено очков ${spent}, а уровень ${level}`);
  // items: level and stats inside what the game can make
  const inv = Array.isArray(sv.inv) ? sv.inv : [], eq = sv.eq || {};
  if (inv.length > 3000) add('inv', true, `${inv.length} вещей`);
  const lvlCap = Math.max(floor, room) + 5;
  let worst = null;
  for (const it of inv) {
    if (!it || typeof it !== 'object') continue;
    const il = num(it.ilvl, 1), worn = eq[it.slot] === it.uid;
    if (il > lvlCap + 25) add('ilvl', true, `${it.name || 'вещь'} уровня ${il} при рекорде ${floor}`);
    else if (il > lvlCap) add('ilvl', false, `${it.name || 'вещь'} уровня ${il} при рекорде ${floor}`);
    for (const k in it.stats || {}) {
      const old = it.up && !it.upv2 && !(L.STAT_INFO[k] && L.STAT_INFO[k].pct) ? Math.pow(1.08 / 1.025, it.up) : 1;   // made before the upgrade change: the game shrinks it on the next load
      const v = num(it.stats[k]) / old, mx = statMax(it.slot, k, il, it.rarity, it.fused);
      const r = v / mx;
      const pct = !!(L.STAT_INFO[k] && L.STAT_INFO[k].pct);   // percent stats have hard caps in the game and old versions scaled them higher
      if (r > 1 && (!worst || r * (pct ? 0.5 : 1) > worst.r * (worst.pct ? 0.5 : 1))) worst = { r, worn, pct, msg: `${it.name || 'вещь'} (ур. ${il}${it.fused ? ', слияние ×' + it.fused : ''}): ${k} ${v} при максимуме ~${Math.round(mx)}` };
    }
    if (it.fx) for (const k in it.fx) if (num(it.fx[k]) > 40 * (1 + il * 0.01) * (1 + (it.fused | 0))) add('fx', false, `${it.name || 'вещь'}: свойство ${k} = ${it.fx[k]}`);
  }
  let ratio = 0;
  for (const it of inv) if (it && it.stats) for (const k in it.stats) ratio = Math.max(ratio, num(it.stats[k]) / (it.up && !it.upv2 && !(L.STAT_INFO[k] && L.STAT_INFO[k].pct) ? Math.pow(1.08 / 1.025, it.up) : 1) / statMax(it.slot, k, num(it.ilvl, 1), it.rarity, it.fused));
  if (worst) add('stat', worst.r > 1.5 && !worst.pct, worst.msg + (worst.r > 1.5 ? ` (в ${worst.r.toFixed(1)} раза больше)` : ''));
  const items = inv.filter(it => it && eq[it.slot] === it.uid);
  let power = 0;
  try { power = L.duelPower(L.duelHero(sv)); } catch (e) { add('broken', true, 'сохранение не читается: ' + e.message); }
  return { issues: out, power, level, floor, wins, items: items.length, ratio: Math.round(ratio * 100) / 100 };
}

/* Can this hero beat the boss of a floor it claims to have passed? The engine runs the real fight several times
   with the strongest pity the game gives (−30% enemies). */
function bossBelow(r) { r = Math.floor(r); while (r > 1 && !L.isBossRoom(r)) r--; return r; }
function canwin(sv, room, seeds) {
  room = bossBelow(room);
  const hs = L.heroStats(sv.level, (sv.inv || []).filter(it => it && (sv.eq || {})[it.slot] === it.uid), sv.skills || {}, sv.cls);
  let wins = 0;
  for (let s = 1; s <= seeds; s++) {
    const f = L.createFight(hs, room, 'progress', L.mulberry32(room * 977 + s), { diff: 0.7 });
    let n = 0;
    while (!f.done && n < 9000) { L.stepFight(f, 1 / 30); f.events.length = 0; n++; }
    if (f.result === 'win') { wins++; break; }
  }
  return { room, wins, tries: seeds };
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  let r;
  try {
    load();
    const q = JSON.parse(line);
    if (q.op === 'check') r = check(q.save || {});
    else if (q.op === 'canwin') r = canwin(q.save || {}, q.room | 0, Math.max(1, Math.min(8, q.seeds | 0 || 4)));
    else r = { error: 'op' };
  } catch (e) { r = { error: String(e && e.message || e) }; }
  process.stdout.write(JSON.stringify(r) + '\n');
});
