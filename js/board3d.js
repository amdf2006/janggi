// 원근 장기판 — 판을 뒤로 눕히고, 캐릭터가 교차점 위에 서서 걷고 싸움
import { art } from './characters.js';
import { PIECES } from './rules.js';
import { sfx } from './fx.js';

// ── 투영 ─────────────────────────────────────
const M = 0.62;               // 판 여백 (칸 단위)
const TILT = 40 * Math.PI / 180;
const CAM = 17;               // 카메라 거리 (칸 단위)
const FIG = 2.05;             // 캐릭터 키 (칸 단위)
const DEPTH = 9 + 2 * M;

function raw(X, T) {          // X: 가로(중앙 0), T: 앞 가장자리에서의 거리
  const y3 = T * Math.cos(TILT), z3 = T * Math.sin(TILT);
  const k = CAM / (CAM + z3);
  return { x: X * k, y: -y3 * k, k };
}
const near = raw(-(4 + M), 0), farTop = raw(0, DEPTH), row0 = raw(0, 9 + M);
const minX = near.x, maxX = -near.x;
const minY = Math.min(farTop.y, row0.y - FIG * row0.k) - 0.15;
const maxY = 0.55;            // 앞쪽 판 두께 + 여유
export const W = maxX - minX, H = maxY - minY;
export const ASPECT = W / H;

// 표시 좌표(col 0~8, row 0~9, row 0 = 먼 쪽) → 화면 %
export function pt(col, row) {
  const p = raw(col - 4, (9 - row) + M);
  return { x: ((p.x - minX) / W) * 100, y: ((p.y - minY) / H) * 100, k: p.k, u: (p.k / W) * 100 };
}
export function place(el, col, row) {
  const p = pt(col, row);
  el.style.left = p.x + '%'; el.style.top = p.y + '%';
  el.style.setProperty('--u', p.u + 'cqw');
  el.style.zIndex = 10 + row * 10;
  return p;
}

// ── 판 그리기 (SVG) ──────────────────────────
let uid = 0;
export function buildBoard(container) {
  const id = 'b' + (++uid);
  container.innerHTML = '';
  container.classList.add('stage');
  container.style.aspectRatio = ASPECT;
  const P = (X, T) => { const p = raw(X, T); return `${p.x},${p.y}`; };
  const e = 4 + M;
  let lines = '';
  const L = (x1, t1, x2, t2, w = 0.045) => { const a = raw(x1, t1), b = raw(x2, t2); lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${w * a.k}"/>`; };
  for (let r = 0; r < 10; r++) L(-4, r + M, 4, r + M, r === 0 || r === 9 ? 0.07 : 0.045);
  for (let c = -4; c <= 4; c++) L(c, M, c, 9 + M, c === -4 || c === 4 ? 0.07 : 0.045);
  for (const t0 of [0, 7]) { L(-1, t0 + M, 1, t0 + 2 + M); L(1, t0 + M, -1, t0 + 2 + M); }
  const nl = raw(-e, 0), nr = raw(e, 0);
  const svg = `
  <svg class="stage-svg" viewBox="${minX} ${minY} ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c9a265"/><stop offset=".55" stop-color="#ddb97c"/><stop offset="1" stop-color="#e6c891"/>
      </linearGradient>
      <linearGradient id="${id}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5f2c"/><stop offset="1" stop-color="#5a3b18"/></linearGradient>
      <pattern id="${id}g" width=".9" height=".18" patternUnits="userSpaceOnUse"><path d="M0 .09 Q.45 .03 .9 .09" stroke="rgba(110,70,25,.12)" stroke-width=".02" fill="none"/></pattern>
    </defs>
    <polygon points="${nl.x},${nl.y} ${nr.x},${nr.y} ${nr.x},${nr.y + 0.42} ${nl.x},${nl.y + 0.42}" fill="url(#${id}e)"/>
    <polygon points="${P(-e, 0)} ${P(e, 0)} ${P(e, DEPTH)} ${P(-e, DEPTH)}" fill="url(#${id}w)"/>
    <polygon points="${P(-e, 0)} ${P(e, 0)} ${P(e, DEPTH)} ${P(-e, DEPTH)}" fill="url(#${id}g)"/>
    <polygon points="${P(-e, 0)} ${P(e, 0)} ${P(e, DEPTH)} ${P(-e, DEPTH)}" fill="none" stroke="#7a5224" stroke-width=".06"/>
    <g stroke="#4b3118" stroke-linecap="round">${lines}</g>
  </svg>
  <div class="layer marks"></div><div class="layer units"></div><div class="layer fxl"></div><div class="layer marks2"></div><div class="layer hit"></div>`;
  container.insertAdjacentHTML('beforeend', svg);
  return {
    marks: container.querySelector('.marks'), marks2: container.querySelector('.marks2'), hit: container.querySelector('.hit'),
    units: container.querySelector('.units'), fx: container.querySelector('.fxl'), root: container,
  };
}

// ── 유닛 ─────────────────────────────────────
export function makeUnit(p) {
  const info = PIECES[p.type];
  const a = art(p.side, p.type);
  const el = document.createElement('div');
  el.className = `unit ${p.side} sz-${info.size}`;
  el.innerHTML = `<div class="disc"><b>${info[p.side]}</b></div>` +
    (a ? `<img class="fig" src="${a.base}" alt="${a.name}" draggable="false">` : `<div class="fig tokenfig"><span>${info[p.side]}</span></div>`);
  el._art = a; el._p = p;
  return el;
}
function setPose(el, pose) { if (el._art) el.querySelector('.fig').src = el._art[pose] || el._art.base; }
function face(el, dir) { const f = el.querySelector('.fig'); if (dir < 0) f.classList.add('flip'); else if (dir > 0) f.classList.remove('flip'); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function lerpPt(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, u: a.u + (b.u - a.u) * t }; }

async function walk(el, a, b, ms, row) {
  el.style.zIndex = 10 + row * 10 + 5;
  const fig = el.querySelector('.fig');
  fig.classList.add('walking');
  const anim = el.animate([
    { left: a.x + '%', top: a.y + '%', '--u': a.u + 'cqw' },
    { left: b.x + '%', top: b.y + '%', '--u': b.u + 'cqw' },
  ], { duration: ms, easing: 'linear', fill: 'forwards' });
  await anim.finished.catch(() => {});
  el.style.left = b.x + '%'; el.style.top = b.y + '%'; el.style.setProperty('--u', b.u + 'cqw');
  anim.cancel();
  fig.classList.remove('walking');
}

function shake(root, ms) {
  root.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-6px,3px)' }, { transform: 'translate(5px,-3px)' }, { transform: 'translate(-2px,2px)' }, { transform: 'translate(0,0)' }], { duration: ms });
}
function slash(fxLayer, at, ms) {
  const s = document.createElement('div'); s.className = 'fx-slash';
  s.style.left = at.x + '%'; s.style.top = (at.y - 1.05 * at.u * ASPECT) + '%'; s.style.setProperty('--u', at.u + 'cqw');
  fxLayer.appendChild(s);
  s.animate([{ opacity: 0, transform: 'translate(-50%,-50%) rotate(-32deg) scaleX(.1)' }, { opacity: 1, offset: .3, transform: 'translate(-50%,-50%) rotate(-32deg) scaleX(1)' }, { opacity: 0, transform: 'translate(-50%,-50%) rotate(-32deg) scaleX(1.2)' }], { duration: ms, easing: 'ease-out' }).finished.then(() => s.remove());
}
function bolt(fxLayer, a, b, ms) {
  const s = document.createElement('div'); s.className = 'fx-bolt';
  const off = (p) => ({ x: p.x, y: p.y - 1.05 * p.u * ASPECT });
  const A = off(a), B = off(b);
  const ang = Math.atan2((B.y - A.y) / ASPECT, B.x - A.x) * 180 / Math.PI;
  s.style.setProperty('--u', a.u + 'cqw');
  fxLayer.appendChild(s);
  return s.animate([{ left: A.x + '%', top: A.y + '%', transform: `translate(-50%,-50%) rotate(${ang}deg)` }, { left: B.x + '%', top: B.y + '%', transform: `translate(-50%,-50%) rotate(${ang}deg)` }], { duration: ms, easing: 'ease-in' }).finished.then(() => s.remove());
}

// 이동 (잡기 없음)
export async function animateMove(view, el, from, to, { mode = 'full', sound = true } = {}) {
  const a = pt(from.col, from.row), b = pt(to.col, to.row);
  const dist = Math.hypot(to.col - from.col, to.row - from.row);
  if (mode === 'off' || reduce()) {
    await walk(el, a, b, 260, Math.max(from.row, to.row));
  } else {
    const k = mode === 'short' ? 0.6 : 1;
    face(el, to.col - from.col);
    setPose(el, 'move');
    await walk(el, a, b, Math.min(1100, Math.max(380, dist * 230)) * k, Math.max(from.row, to.row));
    setPose(el, 'base'); face(el, 1);
  }
  el.style.zIndex = 10 + to.row * 10;
  sfx('move', sound);
}

// 잡기: 다가가서 공격 → 상대 피격·쓰러짐 → 그 자리로 들어감
export async function animateCapture(view, el, victim, from, to, { mode = 'full', sound = true } = {}) {
  const a = pt(from.col, from.row), b = pt(to.col, to.row);
  if (mode === 'off' || reduce()) {
    victim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
    await walk(el, a, b, 280, Math.max(from.row, to.row));
    victim.remove(); el.style.zIndex = 10 + to.row * 10; sfx('thud', sound); return;
  }
  const k = mode === 'short' ? 0.55 : 1;
  const ms = (v) => Math.round(v * k);
  const dir = Math.sign(to.col - from.col);
  const ranged = el._p.type === 'c';
  const dist = Math.hypot(to.col - from.col, to.row - from.row);
  const stand = ranged ? a : lerpPt(a, b, Math.max(0, 1 - 0.62 / dist));

  // 1) 다가가기
  face(el, dir || 1);
  if (!ranged) {
    setPose(el, 'move');
    sfx('move', sound);
    await walk(el, a, stand, Math.min(1000, Math.max(320, dist * 210)) * k, Math.max(from.row, to.row));
  }
  // 상대는 공격자를 바라봄
  face(victim, -(dir || 1));

  // 2) 공격
  setPose(el, 'attack');
  const fig = el.querySelector('.fig');
  fig.animate([{ translate: '0 0' }, { translate: `${(dir || 1) * 14}% -4%` }, { translate: '0 0' }], { duration: ms(360), easing: 'cubic-bezier(.3,1.4,.4,1)' });
  if (ranged) { sfx('whoosh', sound); await bolt(view.fx, a, b, ms(260)); }
  else await wait(ms(150));
  sfx('clash', sound);
  slash(view.fx, b, ms(380));
  shake(view.root, ms(260));

  // 3) 피격 — 맞는 방향 반대로 밀려남 (피격 그림은 왼쪽에서 맞는 기준)
  const vf = victim.querySelector('.fig');
  if (victim._art) { setPose(victim, 'hit'); if (dir > 0) vf.classList.remove('flip'); else if (dir < 0) vf.classList.add('flip'); }
  else victim.classList.add('cracked');
  vf.animate([{ translate: '0 0' }, { translate: `${(dir || 1) * 12}% 0` }, { translate: `${(dir || 1) * 8}% 0` }], { duration: ms(320), easing: 'ease-out', fill: 'forwards' });
  await wait(ms(460));

  // 4) 쓰러짐
  setPose(victim, 'down');
  sfx('fall', sound);
  const fade = victim.animate([{ opacity: 1, filter: 'brightness(1)' }, { opacity: 1, offset: .45, filter: 'brightness(.7) saturate(.7)' }, { opacity: 0, filter: 'brightness(.35) saturate(.3)' }], { duration: ms(820), easing: 'ease-in', fill: 'forwards' });
  await wait(ms(560));

  // 5) 그 칸으로 들어감
  setPose(el, 'move');
  await walk(el, stand, b, ms(ranged ? Math.min(900, dist * 200) : 260), Math.max(from.row, to.row));
  await fade.finished.catch(() => {});
  victim.remove();
  setPose(el, 'base'); face(el, 1);
  el.style.zIndex = 10 + to.row * 10;
}
