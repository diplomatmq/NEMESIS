// Runs the game's own fight engine (the <script id="logic"> block of public/index.html) for the duel server.
// stdin: {"mode":"fight","a":save,"b":save,"seed":n}, {"mode":"gr","saves":[save,...],"b":bossLevel,"seed":n} or {"mode":"stats","saves":[save,...]}  ->  stdout: JSON
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const m = /<script id="logic">([\s\S]*?)<\/script>/.exec(html);
if (!m) { process.stdout.write(JSON.stringify({ error: 'logic not found' })); process.exit(0); }
const L = new Function(m[1] + ';return Logic;')();
let raw = '';
process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => {
  try {
    const q = JSON.parse(raw);
    const card = sv => { const s = L.duelHero(sv); return { hp: Math.round(s.hp), atk: Math.round(s.atk), def: Math.round(s.def), power: L.duelPower(s), s }; };
    if (q.mode === 'stats') {
      process.stdout.write(JSON.stringify({ stats: q.saves.map(sv => { const c = card(sv); delete c.s; return c; }) }));
      return;
    }
    if (q.mode === 'gr') {     // a group against a boss: the heroes as their saves have them, one seed for everyone's replay
      const hs = q.saves.map(sv => L.duelHero(sv)), lvs = q.saves.map(sv => (sv.level | 0) || 1), b = q.b | 0, seed = q.seed | 0;
      const r = L.grFight(hs, b, seed, lvs);
      r.hs = hs; r.lvs = lvs; r.seed = seed; r.b = b;
      r.rewards = r.win ? L.grRewards(b, r.dmg, L.mulberry32((seed ^ 0x5bd1e995) >>> 0), r.eff) : null;
      process.stdout.write(JSON.stringify(r));
      return;
    }
    const A = card(q.a), B = card(q.b);
    const r = L.duelFight(A.s, B.s, q.seed | 0);
    r.hs = [A.s, B.s];          // the player's screen replays the very same fight from these and the seed
    r.seed = q.seed | 0;
    delete A.s; delete B.s;
    r.stats = [A, B];
    process.stdout.write(JSON.stringify(r));
  } catch (e) { process.stdout.write(JSON.stringify({ error: String(e && e.message || e) })); }
});
