import { initRules, Game, SETUPS, PIECES, parseMove, boardMap, makeFen, FILES } from './rules.js';
import { Engine, RemoteEngine } from './engine.js';
import { LEVELS } from './levels.js';
import { art, preload } from './characters.js';
import { sfx, initAudio, setAmbient } from './fx.js';
import { buildBoard, makeUnit, place, animateMove as walkMove, animateCapture } from './board3d.js';

const $ = (s) => document.querySelector(s);
const store = {
  key: 'janggi.v1',
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } },
  save(d) { try { localStorage.setItem(this.key, JSON.stringify(d)); } catch {} },
};
let prefs = Object.assign({ level: 8, side: 'cho', setup: 'NBBN', sound: true, ambient: true, battle: 'full', record: {} }, store.load());

const state = {
  game: null, engine: null, me: 'cho', level: null, selected: null,
  busy: false, anim: false, over: false, flipped: false, undoUsed: false, cpuSetup: null,
};

/* ── 소리 ── */
function clack(heavy = false) { sfx(heavy ? 'thud' : 'tick', prefs.sound); }

/* ── 판 (원근) ──────────────────────────────── */
function sqToCR(sq, flipped) {
  const f = FILES.indexOf(sq[0]); const r = +sq.slice(1) - 1;
  return flipped ? { col: 8 - f, row: r } : { col: f, row: 9 - r };
}
function crToSq(col, row, flipped) {
  return flipped ? FILES[8 - col] + (row + 1) : FILES[col] + (10 - row);
}

let view = null, unitEls = {};

function buildPlayBoard() {
  view = buildBoard($('#board'));
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const btn = document.createElement('button');
    place(btn, col, row); btn.style.zIndex = '';
    btn.dataset.col = col; btn.dataset.row = row;
    btn.addEventListener('click', (e) => { if (e.detail === 0) { e.stopPropagation(); onSquare(crToSq(col, row, state.flipped)); } });
    view.hit.appendChild(btn);
  }
  relabelHits();
  // 클릭 판정: 갈 자리 → 캐릭터 그림(앞에 있는 것 우선) → 가장 가까운 교차점
  view.root.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.hit button');
    if (btn && e.detail === 0) return; // 키보드 Enter는 버튼 자체 핸들러가 처리
    e.stopPropagation();
    const x = e.clientX, y = e.clientY;
    const ptOf = (sq) => { const b = view.hit.querySelector(`button[aria-label="${sq}"]`); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, rad: r.width * 0.6 }; };
    const g = state.game; if (!g) return;
    if (state.selected) {
      const dests = g.legal().map(parseMove).filter((m) => m.from === state.selected && !m.pass).map((m) => m.to);
      for (const d of dests) { const p = ptOf(d); if (Math.hypot(x - p.x, y - p.y) < p.rad) return onSquare(d); }
      for (const d of dests) { const u = unitEls[d]; if (u && inside(u, x, y)) return onSquare(d); }
    }
    const order = Object.entries(unitEls).sort((a, b) => (+b[1].style.zIndex || 0) - (+a[1].style.zIndex || 0));
    for (const [sq, u] of order) if (inside(u, x, y)) return onSquare(sq);
    let best = null, bd = 1e9;
    view.hit.querySelectorAll('button').forEach((b) => { const r = b.getBoundingClientRect(); const d = Math.hypot(x - (r.x + r.width / 2), y - (r.y + r.height / 2)); if (d < bd) { bd = d; best = b; } });
    if (best && bd < best.getBoundingClientRect().width) onSquare(best.getAttribute('aria-label'));
  });
}
function inside(u, x, y) {
  for (const part of u.querySelectorAll('.fig, .disc')) { const r = part.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true; }
  return false;
}
function relabelHits() {
  view.hit.querySelectorAll('button').forEach((b) => b.setAttribute('aria-label', crToSq(+b.dataset.col, +b.dataset.row, state.flipped)));
}

function addUnit(layer, p, sq, flipped, clickable) {
  const el = makeUnit(p); const { col, row } = sqToCR(sq, flipped);
  place(el, col, row); layer.appendChild(el);
  if (clickable) el.addEventListener('click', () => onSquare(el._sq));
  el._sq = sq;
  return el;
}

function renderAll() {
  view.units.innerHTML = ''; unitEls = {};
  const map = state.game.map();
  for (const sq in map) unitEls[sq] = addUnit(view.units, map[sq], sq, state.flipped, true);
  renderMarks();
}

function renderMarks() {
  view.marks.innerHTML = ''; view.marks2.innerHTML = '';
  view.root.classList.toggle('picking', !!state.selected);
  const add = (sq, cls) => { const d = document.createElement('div'); d.className = 'mk ' + cls; const { col, row } = sqToCR(sq, state.flipped); place(d, col, row); d.style.zIndex = ''; (cls.startsWith('last') ? view.marks : view.marks2).appendChild(d); };
  const g = state.game;
  const last = g.moves[g.moves.length - 1];
  if (last) { const mv = parseMove(last.uci); if (!mv.pass) { add(mv.from, 'last from'); add(mv.to, 'last'); } }
  Object.values(unitEls).forEach((e) => e.classList.remove('selected', 'checked', 'target'));
  if (state.selected) {
    add(state.selected, 'sel');
    if (unitEls[state.selected]) unitEls[state.selected].classList.add('selected');
    const map = g.map();
    for (const m of g.legal()) {
      const mv = parseMove(m);
      if (mv.from === state.selected && !mv.pass) {
        add(mv.to, map[mv.to] ? 'dot cap' : 'dot');
        if (map[mv.to] && unitEls[mv.to]) unitEls[mv.to].classList.add('target');
      }
    }
  }
  if (g.isCheck()) {
    const map = g.map(); const t = g.turn();
    for (const sq in map) if (map[sq].type === 'k' && map[sq].side === t && unitEls[sq]) unitEls[sq].classList.add('checked');
  }
}

function callout(text, side) {
  const c = $('#callout'); c.textContent = text; c.className = 'callout ' + (side || '');
  void c.offsetWidth; c.classList.add('show');
}

/* ── 선수 정보 ──────────────────────────── */
function renderPlayers() {
  const g = state.game; const me = state.me; const cpu = me === 'cho' ? 'han' : 'cho';
  const lv = state.level;
  const block = (side, name, sub) => {
    const caps = g.captured[side].map((t) => `<i class="${side === 'cho' ? 'han' : 'cho'}">${PIECES[t][side === 'cho' ? 'han' : 'cho']}</i>`).join('');
    const turn = !state.over && g.turn() === side;
    const thinking = turn && side === cpu && state.busy ? '<span class="thinking">수 읽는 중…</span>' : '';
    return { html: `<div class="badge ${side}">${side === 'cho' ? '楚' : '漢'}</div><div class="who"><b>${name}</b><small>${sub} ${thinking}</small></div><div class="caps">${caps}</div><div class="pts">${g.score(side).toFixed(1)}점</div>`, turn };
  };
  const top = block(cpu, `컴퓨터 ${lv.name}`, cpu === 'cho' ? '초 · 선수' : '한 · 후수');
  const bot = block(me, '나', me === 'cho' ? '초 · 선수' : '한 · 후수');
  $('#pTop').innerHTML = top.html; $('#pTop').classList.toggle('turn', top.turn);
  $('#pBottom').innerHTML = bot.html; $('#pBottom').classList.toggle('turn', bot.turn);
}

function renderMoves() {
  const g = state.game; const ol = $('#moves');
  ol.innerHTML = g.moves.map((m, i) => `<li class="${m.mover}">${g.label(i)}</li>`).join('');
  ol.scrollTop = ol.scrollHeight;
}

function renderControls() {
  const g = state.game; const myTurn = !state.over && !state.busy && !state.anim && g.turn() === state.me;
  const canPass = myTurn && g.legal().some((m) => parseMove(m).pass);
  $('#passBtn').disabled = !canPass;
  $('#undoBtn').disabled = state.busy || state.anim || state.over || g.moves.filter((m) => m.mover === state.me).length === 0;
  $('#resignBtn').disabled = state.over;
  let s = '';
  if (state.over) s = '대국이 끝났습니다.';
  else if (state.busy) s = '컴퓨터가 수를 읽고 있습니다.';
  else if (g.isCheck()) s = '장군입니다. 궁을 지키세요.';
  else s = '내 차례입니다. 움직일 말을 고르세요.';
  $('#status').textContent = s;
}

function refresh() { renderMarks(); renderPlayers(); renderMoves(); renderControls(); }

/* ── 진행 ───────────────────────────────── */
async function doMove(uci) {
  const g = state.game;
  const wasCheck = g.isCheck();
  const mv = parseMove(uci);
  const before = g.map();
  const victim = !mv.pass ? before[mv.to] : null;
  state.selected = null;
  if (!mv.pass) {
    state.anim = true; renderMarks(); renderControls();
    const el = unitEls[mv.from];
    const from = sqToCR(mv.from, state.flipped), to = sqToCR(mv.to, state.flipped);
    const opts = { mode: prefs.battle, sound: prefs.sound };
    if (el) {
      if (victim && unitEls[mv.to]) await animateCapture(view, el, unitEls[mv.to], from, to, opts);
      else await walkMove(view, el, from, to, opts);
      delete unitEls[mv.from]; unitEls[mv.to] = el; el._sq = mv.to;
    }
    state.anim = false;
    if (state.game !== g) return;
  }
  g.push(uci);
  if (mv.pass) { clack(); callout('한수쉼', g.moves[g.moves.length - 1].mover); }
  else if (g.isCheck()) { const side = g.moves[g.moves.length - 1].mover; callout('장군', side); sfx('jang', prefs.sound, { side }); }
  else if (wasCheck) { const side = g.moves[g.moves.length - 1].mover; callout('멍군', side); sfx('meong', prefs.sound, { side }); }
  refresh();
  const out = g.outcome();
  if (out) return setTimeout(() => finish(out), 700);
  if (g.turn() !== state.me) setTimeout(cpuMove, 300);
}

async function cpuMove() {
  const g = state.game; if (state.over) return;
  state.busy = true; refresh();
  const t0 = performance.now();
  const startMoves = g.moves.map((m) => m.uci);
  let mv;
  try { mv = await state.engine.choose(g.startFen, startMoves, g.legal(), state.level.x); }
  catch (e) { console.error(e); mv = g.legal()[0]; }
  const wait = Math.max(0, 450 - (performance.now() - t0));
  await new Promise((r) => setTimeout(r, wait));
  if (state.game !== g || state.over) return; // 그 사이 나갔거나 무르기
  state.busy = false;
  doMove(mv);
}

function onSquare(sq) {
  const g = state.game;
  if (!g || state.over || state.busy || state.anim || g.turn() !== state.me) return;
  const map = g.map();
  if (state.selected) {
    const m = g.legal().find((u) => { const p = parseMove(u); return p.from === state.selected && p.to === sq && !p.pass; });
    if (m) return doMove(m);
  }
  if (map[sq] && map[sq].side === state.me) { state.selected = state.selected === sq ? null : sq; clack(); }
  else state.selected = null;
  renderMarks();
}

function finish(out) {
  state.over = true; refresh();
  const lv = state.level.name;
  const rec = prefs.record[lv] || { w: 0, l: 0, d: 0 };
  let title;
  if (!out.winner) { title = '무승부'; rec.d++; sfx('lose', prefs.sound); }
  else if (out.winner === state.me) { title = '승리'; rec.w++; sfx('win', prefs.sound); }
  else { title = '패배'; rec.l++; sfx('lose', prefs.sound); }
  prefs.record[lv] = rec; store.save(prefs);
  $('#resTitle').textContent = title;
  $('#resReason').textContent = `${out.reason} · 상대 ${lv}` + (state.undoUsed && out.winner === state.me ? ' (무르기 사용)' : '');
  $('#resScore').textContent = `점수 초 ${state.game.score('cho').toFixed(1)} : 한 ${state.game.score('han').toFixed(1)} · 이 급수 전적 ${rec.w}승 ${rec.l}패${rec.d ? ' ' + rec.d + '무' : ''}`;
  $('#result').showModal();
}

async function startGame() {
  if (state.game) state.game.destroy();
  const lvIdx = +$('#levelRange').value;
  state.level = LEVELS[lvIdx];
  let side = document.querySelector('input[name=side]:checked').value;
  prefs.side = side; prefs.level = lvIdx; store.save(prefs);
  if (side === 'random') side = Math.random() < 0.5 ? 'cho' : 'han';
  state.me = side; state.flipped = side === 'han';
  state.cpuSetup = SETUPS[Math.floor(Math.random() * 4)].id;
  const mine = prefs.setup;
  state.game = side === 'cho' ? new Game(mine, state.cpuSetup) : new Game(state.cpuSetup, mine);
  state.selected = null; state.over = false; state.busy = false; state.undoUsed = false;
  await state.engine.newGame();
  $('#lobby').hidden = true; $('#play').hidden = false;
  const cpuName = SETUPS.find((s) => s.id === state.cpuSetup).name;
  $('#matchTitle').textContent = `나 (${SETUPS.find((s) => s.id === mine).name}) 대 컴퓨터 ${state.level.name} (${cpuName})`;
  relabelHits(); renderAll(); refresh();
  sfx('drum', prefs.sound); setAmbient(prefs.sound && prefs.ambient);
  if (state.game.turn() !== state.me) setTimeout(cpuMove, 600);
}

function toLobby() {
  $('#result').close?.();
  if (state.game) { state.game.destroy(); state.game = null; }
  state.busy = false;
  $('#play').hidden = true; $('#lobby').hidden = false;
  setAmbient(false);
  updateLevelUI();
}

/* ── 시작 화면 ──────────────────────────── */
function updateLevelUI() {
  const i = +$('#levelRange').value; const lv = LEVELS[i];
  $('#levelName').textContent = lv.name;
  $('#levelDesc').textContent = lv.desc;
  const r = prefs.record[lv.name];
  $('#levelRecord').textContent = r ? `이 급수 전적: ${r.w}승 ${r.l}패${r.d ? ' ' + r.d + '무' : ''}` : '아직 둔 기록이 없습니다.';
}

function buildSetupPicker() {
  const wrap = $('#setupPick');
  wrap.innerHTML = SETUPS.map((s) => `<label><input type="radio" name="setup" value="${s.id}" ${s.id === prefs.setup ? 'checked' : ''}><span class="chip"><span class="mini">${s.id.split('').map((c) => `<i>${c === 'N' ? '馬' : '象'}</i>`).join('')}</span>${s.name}</span></label>`).join('');
  wrap.addEventListener('change', (e) => { prefs.setup = e.target.value; store.save(prefs); drawHero(); });
}

function drawHero() {
  const v = buildBoard($('#heroBoard'));
  const map = boardMap(makeFen(prefs.setup, 'NBBN'));
  for (const sq in map) addUnit(v.units, map[sq], sq, false, false);
}

async function boot() {
  $('#levelRange').max = LEVELS.length - 1;
  $('#levelRange').value = Math.min(prefs.level, LEVELS.length - 1);
  const sideInput = document.querySelector(`input[name=side][value=${prefs.side}]`); if (sideInput) sideInput.checked = true;
  $('#levelRange').addEventListener('input', updateLevelUI);
  updateLevelUI();
  $('#soundBtn').textContent = prefs.sound ? '소리 켬' : '소리 끔';
  $('#soundBtn').setAttribute('aria-pressed', prefs.sound);
  $('#soundBtn').onclick = () => { prefs.sound = !prefs.sound; store.save(prefs); $('#soundBtn').textContent = prefs.sound ? '소리 켬' : '소리 끔'; $('#soundBtn').setAttribute('aria-pressed', prefs.sound); setAmbient(prefs.sound && prefs.ambient && !$('#play').hidden); };
  const setAmbBtn = () => { $('#ambBtn').textContent = prefs.ambient ? '배경음 켬' : '배경음 끔'; $('#ambBtn').setAttribute('aria-pressed', prefs.ambient); };
  setAmbBtn();
  $('#ambBtn').onclick = () => { prefs.ambient = !prefs.ambient; store.save(prefs); setAmbBtn(); setAmbient(prefs.sound && prefs.ambient && !$('#play').hidden); };
  initAudio();

  const BM = { full: '전투 연출: 전체', short: '전투 연출: 짧게', off: '전투 연출: 끔' };
  const setBM = () => { $('#battleBtn').textContent = BM[prefs.battle]; };
  setBM();
  $('#battleBtn').onclick = () => { prefs.battle = { full: 'short', short: 'off', off: 'full' }[prefs.battle]; store.save(prefs); setBM(); };
  preload();
  await initRules();
  buildSetupPicker(); drawHero(); buildPlayBoard();

  $('#startBtn').onclick = startGame;
  $('#backBtn').onclick = toLobby;
  $('#lobbyBtn').onclick = toLobby;
  $('#againBtn').onclick = () => { $('#result').close(); startGame(); };
  $('#passBtn').onclick = () => { const m = state.game.legal().find((u) => parseMove(u).pass); if (m) doMove(m); };
  $('#undoBtn').onclick = () => {
    const g = state.game; if (state.busy || state.over) return;
    // 내 마지막 수까지 되돌림
    while (g.moves.length && g.moves[g.moves.length - 1].mover !== state.me) g.pop();
    if (g.moves.length) g.pop();
    state.undoUsed = true; state.selected = null; renderAll(); refresh();
    if (g.turn() !== state.me) setTimeout(cpuMove, 400);
  };
  $('#resignBtn').onclick = () => {
    if (state.over || !confirm('기권하시겠습니까?')) return;
    finish({ winner: state.me === 'cho' ? 'han' : 'cho', reason: '기권' });
  };

  const local = Engine.supported();
  try {
    state.engine = local ? new Engine() : new RemoteEngine();
    await state.engine.init();
  } catch (e) {
    console.error(e);
    // 브라우저 엔진이 실패하면 서버 엔진으로 한 번 더 시도
    if (local) { try { state.engine = new RemoteEngine(); await state.engine.init(); } catch (e2) { state.engine = null; } }
    else state.engine = null;
  }
  if (state.engine) {
    $('#startBtn').disabled = false; $('#startBtn').textContent = '대국 시작';
    if (state.engine instanceof RemoteEngine) $('#engineNote').textContent = '이 기기에서는 서버 엔진으로 둡니다. 컴퓨터의 수가 1~2초 늦을 수 있습니다.';
  } else {
    $('#startBtn').textContent = '엔진을 불러오지 못했습니다';
    $('#engineNote').textContent = '인터넷 연결을 확인하고 새로고침해 주세요.'; $('#engineNote').classList.add('err');
  }
}
boot();
