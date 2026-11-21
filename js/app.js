import { initRules, Game, SETUPS, PIECES, parseMove, boardMap, makeFen, FILES } from './rules.js';
import { Engine } from './engine.js';
import { LEVELS } from './levels.js';
import { art, preload } from './characters.js';
import { battle, moveGhost, sfx } from './fx.js';

const $ = (s) => document.querySelector(s);
const store = {
  key: 'janggi.v1',
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } },
  save(d) { try { localStorage.setItem(this.key, JSON.stringify(d)); } catch {} },
};
let prefs = Object.assign({ level: 8, side: 'cho', setup: 'NBBN', sound: true, battle: 'full', record: {} }, store.load());

const state = {
  game: null, engine: null, me: 'cho', level: null, selected: null,
  busy: false, anim: false, over: false, flipped: false, undoUsed: false, cpuSetup: null,
};

/* ── 소리 ── */
function clack(heavy = false) { sfx(heavy ? 'thud' : 'move', prefs.sound); }

/* ── 판 그리기 ─────────────────────────────── */
const GX = 9.2, GY = 10.2, M = 0.6;
const pos = (col, row) => ({ left: ((M + col) / GX) * 100 + '%', top: ((M + row) / GY) * 100 + '%' });

function gridSVG(svg) {
  const u = 100, m = 60, W = 920, H = 1020;
  let s = '';
  const L = (x1, y1, x2, y2, w = 2) => (s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w}"/>`);
  for (let r = 0; r < 10; r++) L(m, m + r * u, m + 8 * u, m + r * u);
  for (let f = 0; f < 9; f++) L(m + f * u, m, m + f * u, m + 9 * u);
  // 궁성 대각선
  for (const top of [0, 7]) {
    L(m + 3 * u, m + top * u, m + 5 * u, m + (top + 2) * u);
    L(m + 5 * u, m + top * u, m + 3 * u, m + (top + 2) * u);
  }
  s = `<rect x="${m}" y="${m}" width="${8 * u}" height="${9 * u}" fill="none" stroke-width="4"/>` + s;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `<g stroke="#4b3118" stroke-linecap="square">${s}</g>`;
}

function sqToCR(sq, flipped) {
  const f = FILES.indexOf(sq[0]); const r = +sq.slice(1) - 1;
  return flipped ? { col: 8 - f, row: r } : { col: f, row: 9 - r };
}
function crToSq(col, row, flipped) {
  return flipped ? FILES[8 - col] + (row + 1) : FILES[col] + (10 - row);
}

function makeBoard(container) {
  container.innerHTML = '';
  const b = document.createElement('div'); b.className = 'board';
  b.innerHTML = '<svg class="grid"></svg><div class="layer marks"></div><div class="layer pieces"></div><div class="layer hit"></div>';
  container.appendChild(b);
  gridSVG(b.querySelector('.grid'));
  return b;
}

function pieceEl(p) {
  const el = document.createElement('div');
  const info = PIECES[p.type];
  el.className = `pc ${p.side} ${info.size}`;
  const a = art(p.side, p.type);
  if (a) { el.classList.add('has-art'); el.innerHTML = `<img class="por" src="${a.portrait}" alt=""><b class="hj">${info[p.side]}</b>`; }
  else el.innerHTML = `<span>${info[p.side]}</span>`;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function drawStatic(boardEl, fen, flipped) {
  const layer = boardEl.querySelector('.pieces'); layer.innerHTML = '';
  const map = boardMap(fen);
  for (const sq in map) {
    const el = pieceEl(map[sq]); const { col, row } = sqToCR(sq, flipped);
    Object.assign(el.style, pos(col, row)); layer.appendChild(el);
  }
}

/* ── 대국판 ─────────────────────────────── */
let boardEl, pieceEls = {};

function buildPlayBoard() {
  boardEl = $('#board');
  gridSVG($('#grid'));
  const hit = $('#hit'); hit.innerHTML = '';
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const btn = document.createElement('button');
    Object.assign(btn.style, pos(col, row));
    btn.dataset.col = col; btn.dataset.row = row;
    btn.addEventListener('click', () => onSquare(crToSq(col, row, state.flipped)));
    hit.appendChild(btn);
  }
  relabelHits();
}
function relabelHits() {
  $('#hit').querySelectorAll('button').forEach((b) => {
    const sq = crToSq(+b.dataset.col, +b.dataset.row, state.flipped);
    b.setAttribute('aria-label', sq);
  });
}

function renderAll() {
  const layer = $('#pieces'); layer.innerHTML = ''; pieceEls = {};
  const map = state.game.map();
  for (const sq in map) {
    const el = pieceEl(map[sq]); const { col, row } = sqToCR(sq, state.flipped);
    Object.assign(el.style, pos(col, row)); layer.appendChild(el); pieceEls[sq] = el;
  }
  renderMarks();
}

function animateMove(uci, captured, piece) {
  const mv = parseMove(uci);
  if (mv.pass) return;
  const el = pieceEls[mv.from];
  if (captured && pieceEls[mv.to]) {
    const v = pieceEls[mv.to];
    setTimeout(() => { v.classList.add('gone'); setTimeout(() => v.remove(), 260); }, 200);
  }
  if (el) {
    el.classList.add('moving');
    const fromP = (() => { const c = sqToCR(mv.from, state.flipped); return pos(c.col, c.row); })();
    const toP = (() => { const c = sqToCR(mv.to, state.flipped); return pos(c.col, c.row); })();
    if (piece) moveGhost($('#pieces'), piece, fromP, toP);
    const { col, row } = sqToCR(mv.to, state.flipped);
    Object.assign(el.style, pos(col, row));
    setTimeout(() => el.classList.remove('moving'), 300);
    delete pieceEls[mv.from]; pieceEls[mv.to] = el;
  }
}

function renderMarks() {
  const marks = $('#marks'); marks.innerHTML = '';
  const add = (sq, cls) => { const d = document.createElement('div'); d.className = 'mk ' + cls; const { col, row } = sqToCR(sq, state.flipped); Object.assign(d.style, pos(col, row)); marks.appendChild(d); };
  const g = state.game;
  const last = g.moves[g.moves.length - 1];
  if (last) { const mv = parseMove(last.uci); if (!mv.pass) { add(mv.from, 'last from'); add(mv.to, 'last'); } }
  if (state.selected) {
    add(state.selected, 'sel');
    const map = g.map();
    for (const m of g.legal()) {
      const mv = parseMove(m);
      if (mv.from === state.selected && !mv.pass) add(mv.to, map[mv.to] ? 'dot cap' : 'dot');
    }
  }
  // 장군 표시
  Object.values(pieceEls).forEach((e) => e.classList.remove('checked'));
  if (g.isCheck()) {
    const map = g.map(); const t = g.turn();
    for (const sq in map) if (map[sq].type === 'k' && map[sq].side === t && pieceEls[sq]) pieceEls[sq].classList.add('checked');
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
  const piece = before[mv.from];
  const victim = !mv.pass ? before[mv.to] : null;
  const cap = !!victim;
  state.selected = null;
  if (cap && prefs.battle !== 'off') {
    state.anim = true; renderMarks(); renderControls();
    await battle($('.board-wrap'), piece, victim, { mode: prefs.battle, sound: prefs.sound });
    state.anim = false;
    if (state.game !== g) return;
  }
  g.push(uci);
  animateMove(uci, cap, piece);
  clack(cap);
  if (mv.pass) callout('한수쉼', g.moves[g.moves.length - 1].mover);
  else if (g.isCheck()) setTimeout(() => callout('장군', g.moves[g.moves.length - 1].mover), 180);
  else if (wasCheck) setTimeout(() => callout('멍군', g.moves[g.moves.length - 1].mover), 180);
  refresh();
  const out = g.outcome();
  if (out) return setTimeout(() => finish(out), 700);
  if (g.turn() !== state.me) setTimeout(cpuMove, 350);
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
  if (!out.winner) { title = '무승부'; rec.d++; }
  else if (out.winner === state.me) { title = '승리'; rec.w++; }
  else { title = '패배'; rec.l++; }
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
  if (state.game.turn() !== state.me) setTimeout(cpuMove, 600);
}

function toLobby() {
  $('#result').close?.();
  if (state.game) { state.game.destroy(); state.game = null; }
  state.busy = false;
  $('#play').hidden = true; $('#lobby').hidden = false;
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
  const b = makeBoard($('#heroBoard'));
  drawStatic(b, makeFen(prefs.setup, 'NBBN'), false);
}

async function boot() {
  $('#levelRange').max = LEVELS.length - 1;
  $('#levelRange').value = Math.min(prefs.level, LEVELS.length - 1);
  const sideInput = document.querySelector(`input[name=side][value=${prefs.side}]`); if (sideInput) sideInput.checked = true;
  $('#levelRange').addEventListener('input', updateLevelUI);
  updateLevelUI();
  $('#soundBtn').textContent = prefs.sound ? '소리 켬' : '소리 끔';
  $('#soundBtn').setAttribute('aria-pressed', prefs.sound);
  $('#soundBtn').onclick = () => { prefs.sound = !prefs.sound; store.save(prefs); $('#soundBtn').textContent = prefs.sound ? '소리 켬' : '소리 끔'; $('#soundBtn').setAttribute('aria-pressed', prefs.sound); };

  const BM = { full: '전투 연출: 전체', short: '전투 연출: 짧게', off: '전투 연출: 끔' };
  const setBM = () => { $('#battleBtn').textContent = BM[prefs.battle]; };
  setBM();
  $('#battleBtn').onclick = () => { prefs.battle = { full: 'short', short: 'off', off: 'full' }[prefs.battle]; store.save(prefs); setBM(); };
  $('#previewBtn').onclick = () => { $('#preview').showModal(); };
  $('#pvClose').onclick = () => $('#preview').close();
  const xiang = { type: 'k', side: 'cho' };
  $('#pvBattle').onclick = () => battle($('#pvStage'), xiang, { type: 'r', side: 'han' }, { mode: 'full', sound: prefs.sound });
  $('#pvBattle2').onclick = () => battle($('#pvStage'), { type: 'c', side: 'han' }, xiang, { mode: 'full', sound: prefs.sound });
  $('#pvMove').onclick = () => {
    const st = $('#pvStage'); const a = art('cho', 'k');
    moveGhost(st, xiang, { left: '25%', top: '80%' }, { left: '75%', top: '80%' }, 700); sfx('move', prefs.sound);
  };
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

  if (!Engine.supported()) {
    $('#startBtn').textContent = '이 환경에서는 엔진을 실행할 수 없습니다';
    $('#engineNote').textContent = '서버에 교차 출처 격리 헤더(COOP/COEP)가 필요합니다. Vercel에 올리면 자동 적용됩니다.';
    $('#engineNote').classList.add('err');
    return;
  }
  try {
    state.engine = new Engine(); await state.engine.init();
    $('#startBtn').disabled = false; $('#startBtn').textContent = '대국 시작';
  } catch (e) {
    console.error(e);
    $('#startBtn').textContent = '엔진을 불러오지 못했습니다';
    $('#engineNote').textContent = String(e.message || e); $('#engineNote').classList.add('err');
  }
}
boot();
