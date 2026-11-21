// 연출 — 이동 고스트, 전투 컷신
import { art } from './characters.js';
import { PIECES } from './rules.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 효과음 ──
let actx = null;
export function sfx(kind, enabled = true) {
  if (!enabled) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    const noise = (len, freq, q, gain, decay) => {
      const buf = actx.createBuffer(1, actx.sampleRate * len, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
      const s = actx.createBufferSource(); s.buffer = buf;
      const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = actx.createGain(); g.gain.value = gain;
      s.connect(f).connect(g).connect(actx.destination); s.start(t);
    };
    const ring = (freq, len, gain) => {
      const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + len);
      const g = actx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + len);
    };
    if (kind === 'move') noise(0.07, 1500, 4, 0.7, 6);
    if (kind === 'thud') noise(0.16, 380, 2, 1.1, 3);
    if (kind === 'whoosh') noise(0.25, 900, 0.8, 0.5, 1.5);
    if (kind === 'clash') { noise(0.12, 2600, 3, 0.9, 4); ring(1250, 0.5, 0.18); ring(1870, 0.35, 0.1); }
    if (kind === 'fall') noise(0.35, 220, 1.2, 1.0, 2);
  } catch {}
}

// ── 판 위 이동 고스트: 이동 포즈 전신이 말 위에 잠깐 떠서 함께 이동 ──
export function moveGhost(layer, piece, from, to, dur = 280) {
  const a = art(piece.side, piece.type);
  if (!a || reduce()) return;
  const g = document.createElement('img');
  g.className = 'mghost'; g.src = a.move; g.alt = '';
  if (piece.side === 'han') g.classList.add('flip');
  Object.assign(g.style, { left: from.left, top: from.top });
  layer.appendChild(g);
  g.animate([{ opacity: 0, transform: 'translate(-50%,-92%) scale(.85)' }, { opacity: 1, offset: 0.25, transform: 'translate(-50%,-92%) scale(1)' }, { opacity: 1, offset: 0.75 }, { opacity: 0, transform: 'translate(-50%,-92%) scale(1)' }], { duration: dur + 380, easing: 'ease-out' });
  requestAnimationFrame(() => { g.style.transition = `left ${dur}ms cubic-bezier(.3,.7,.2,1), top ${dur}ms cubic-bezier(.3,.7,.2,1)`; Object.assign(g.style, { left: to.left, top: to.top }); });
  setTimeout(() => g.remove(), dur + 420);
}

// ── 전투 컷신 ──
function fighter(piece, pose) {
  const a = art(piece.side, piece.type);
  const wrap = document.createElement('div');
  wrap.className = `fighter ${piece.side}`;
  if (a) {
    const img = document.createElement('img'); img.src = a[pose] || a.base; img.alt = a.name; wrap.appendChild(img);
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = a.name; wrap.appendChild(tag);
    wrap.setPose = (p) => { img.src = a[p] || a.base; };
  } else {
    const info = PIECES[piece.type];
    wrap.classList.add('token');
    wrap.innerHTML = `<div class="pc ${piece.side} big"><span>${info[piece.side]}</span></div><span class="tag">${info.ko}</span>`;
    wrap.setPose = () => {};
  }
  return wrap;
}

// mode: 'full' | 'short'
export async function battle(container, attacker, defender, { mode = 'full', sound = true } = {}) {
  const k = mode === 'short' ? 0.55 : 1;
  const ms = (v) => Math.round(v * k);
  const ov = document.createElement('div');
  ov.className = 'battle';
  ov.innerHTML = '<div class="b-bg"></div><div class="b-slash"></div><div class="b-flash"></div>';
  const A = fighter(attacker, 'move'); A.classList.add('left');
  const D = fighter(defender, 'base'); D.classList.add('right');
  ov.append(A, D);
  container.appendChild(ov);

  const fast = reduce();
  ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms(160), fill: 'forwards' });
  if (!fast) {
    A.animate([{ transform: 'translateX(-70%)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: ms(380), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    D.animate([{ transform: 'translateX(40%)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: ms(320), easing: 'ease-out', fill: 'forwards' });
  }
  sfx('whoosh', sound);
  await wait(ms(420));

  // 공격
  A.setPose('attack');
  if (!fast) A.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(28%)' }, { transform: 'translateX(18%)' }], { duration: ms(260), easing: 'cubic-bezier(.3,1.4,.4,1)', fill: 'forwards' });
  await wait(ms(150));
  sfx('clash', sound);
  ov.querySelector('.b-slash').animate([{ opacity: 0, transform: 'translate(-50%,-50%) rotate(-28deg) scaleX(.1)' }, { opacity: 1, offset: 0.3, transform: 'translate(-50%,-50%) rotate(-28deg) scaleX(1)' }, { opacity: 0, transform: 'translate(-50%,-50%) rotate(-28deg) scaleX(1.15)' }], { duration: ms(360), easing: 'ease-out' });
  ov.querySelector('.b-flash').animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: ms(220) });
  if (!fast) container.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-7px,4px)' }, { transform: 'translate(6px,-3px)' }, { transform: 'translate(-3px,2px)' }, { transform: 'translate(0,0)' }], { duration: ms(280) });

  // 피격
  D.setPose('hit');
  if (D.classList.contains('token')) D.classList.add('cracked');
  if (!fast) D.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(16%) rotate(4deg)' }, { transform: 'translateX(10%) rotate(2deg)' }], { duration: ms(300), easing: 'ease-out', fill: 'forwards' });
  await wait(ms(480));

  // 쓰러짐
  D.setPose('down');
  sfx('fall', sound);
  D.animate([{ opacity: 1, filter: 'brightness(1)' }, { opacity: 0.9, filter: 'brightness(.55) saturate(.6)' }, { opacity: 0, filter: 'brightness(.3) saturate(.3)' }],
    { duration: ms(D.classList.contains('token') ? 420 : 620), easing: 'ease-in', fill: 'forwards' });
  if (D.classList.contains('token') && !fast) D.querySelector('.pc').animate([{ transform: 'scale(1) rotate(0)' }, { transform: 'scale(.6) rotate(18deg)' }], { duration: ms(420), fill: 'forwards' });
  await wait(ms(520));

  const out = ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms(220), fill: 'forwards' });
  await out.finished.catch(() => {});
  ov.remove();
}
