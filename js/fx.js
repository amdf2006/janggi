// 소리 — 실제 효과음(assets/sfx) + 모바일 잠금 해제 + 합성음 예비
const DIR = 'assets/sfx/';
const FILES = ['move_chariot', 'move_horse', 'move_elephant', 'move_armor', 'move_robe', 'move_cannon',
  'atk_spear', 'atk_sword', 'atk_heavy', 'elephant', 'neigh', 'wind', 'cannon', 'boom', 'hit', 'fall',
  'drum', 'win', 'lose', 'ambient', 'jang_cho', 'meong_cho', 'jang_han', 'meong_han'];
const VOL = { ambient: 0.22, drum: 0.8, win: 0.8, lose: 0.8, move_elephant: 0.9, move_chariot: 0.8, boom: 0.9, cannon: 0.9 };

let actx = null, master = null, unlocked = false;
const buffers = {};
let ambientNode = null, ambientWanted = false;

function ctx() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 1; master.connect(actx.destination);
  }
  return actx;
}

// 모바일: 첫 터치/클릭 때 소리 잠금 해제 + 효과음 불러오기
export function initAudio() {
  const unlock = () => {
    try {
      const c = ctx();
      if (c.state === 'suspended') c.resume();
      const b = c.createBuffer(1, 1, 22050); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
      if (!unlocked) { unlocked = true; loadAll(); }
      if (ambientWanted && !ambientNode) startAmbient();
    } catch {}
  };
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));
}

async function loadAll() {
  const c = ctx();
  await Promise.all(FILES.map(async (n) => {
    try {
      const r = await fetch(DIR + n + '.mp3');
      if (!r.ok) return;
      const ab = await r.arrayBuffer();
      buffers[n] = await new Promise((ok, no) => c.decodeAudioData(ab, ok, no));
    } catch {}
  }));
  if (ambientWanted && !ambientNode) startAmbient();
}

function playBuf(name, { dur = 0, vol = 1, delay = 0, rate = 1 } = {}) {
  const b = buffers[name]; if (!b || !actx) return false;
  const t = actx.currentTime + delay;
  const s = actx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
  const g = actx.createGain(); g.gain.value = vol * (VOL[name] ?? 1);
  s.connect(g).connect(master);
  s.start(t);
  if (dur > 0 && dur < b.duration) { g.gain.setValueAtTime(g.gain.value, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.18); s.stop(t + dur + 0.2); }
  return true;
}

// ── 합성음 (파일이 아직 없을 때 예비) ──
function synth(kind) {
  if (!actx) return;
  const t = actx.currentTime;
  const noise = (len, freq, q, gain, decay) => {
    const buf = actx.createBuffer(1, actx.sampleRate * len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
    const s = actx.createBufferSource(); s.buffer = buf;
    const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = actx.createGain(); g.gain.value = gain;
    s.connect(f).connect(g).connect(master); s.start(t);
  };
  if (kind === 'tick') noise(0.07, 1500, 4, 0.7, 6);
  else if (kind === 'thud' || kind === 'fall') noise(0.2, 300, 1.5, 1.1, 3);
  else if (kind === 'cannon' || kind === 'boom') noise(0.6, 110, 0.7, 1.4, 1.8);
  else noise(0.12, 2400, 3, 0.8, 4);
}

// 기물별 이동 소리
const MOVE = { r: 'move_chariot', n: 'move_horse', b: 'move_elephant', a: 'move_robe', c: 'move_cannon', k: 'move_armor', p: 'move_armor' };

// 캐릭터별 공격 소리 (무기에 맞춤)
function attackSounds(p) {
  const key = p.side + '_' + p.type;
  switch (key) {
    case 'cho_k': return [['atk_heavy']];                       // 항우: 극
    case 'han_k': return [['atk_sword']];                       // 유방: 검
    case 'cho_n': return [['neigh', { vol: 0.7 }], ['atk_heavy', { delay: 0.12 }]]; // 계포: 언월도
    case 'han_n': return [['neigh', { vol: 0.7 }], ['atk_spear', { delay: 0.12 }]]; // 관영: 장창
    case 'cho_b': return [['elephant'], ['atk_spear', { delay: 0.25 }]];
    case 'han_b': return [['elephant'], ['atk_heavy', { delay: 0.25 }]];             // 번쾌: 도끼
    default:
      if (p.type === 'r') return [['neigh', { vol: 0.6 }], ['atk_spear', { delay: 0.1 }]]; // 전차 돌격
      if (p.type === 'a') return [['wind']];                     // 책사: 부채 바람
      return [['atk_spear']];                                    // 졸·병: 창
  }
}

// kind: tick | thud | step | attack | hit | fall | cannon | boom | drum | win | lose | jang | meong
export function sfx(kind, enabled = true, piece = null, dur = 0) {
  if (!enabled) return;
  try {
    ctx();
    if (kind === 'step' && piece) { if (!playBuf(MOVE[piece.type], { dur })) synth('tick'); return; }
    if (kind === 'attack' && piece) { let ok = false; for (const [n, o] of attackSounds(piece)) ok = playBuf(n, o) || ok; if (!ok) synth('clash'); return; }
    if (kind === 'jang' || kind === 'meong') { const side = piece?.side || 'cho'; if (!playBuf(`${kind}_${side}`)) synth('tick'); return; }
    if (['hit', 'fall', 'cannon', 'boom', 'drum', 'win', 'lose'].includes(kind)) { if (!playBuf(kind)) synth(kind); return; }
    synth(kind);
  } catch {}
}

// ── 배경 전장 소리 (반복) ──
function startAmbient() {
  if (!actx || !buffers.ambient || ambientNode) return;
  const s = actx.createBufferSource(); s.buffer = buffers.ambient; s.loop = true;
  const g = actx.createGain(); g.gain.value = 0.0001;
  s.connect(g).connect(master); s.start();
  g.gain.linearRampToValueAtTime(VOL.ambient, actx.currentTime + 1.5);
  ambientNode = { s, g };
}
function stopAmbient() {
  if (!ambientNode) return;
  const { s, g } = ambientNode; ambientNode = null;
  try { g.gain.linearRampToValueAtTime(0.0001, actx.currentTime + 0.8); s.stop(actx.currentTime + 0.9); } catch {}
}
export function setAmbient(on) { ambientWanted = on; if (on) startAmbient(); else stopAmbient(); }
