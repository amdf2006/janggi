// 캐릭터 아트 목록 — 테마별, 진영(cho/han)별, 기물(k,r,c,n,b,a,p)별
// 그림이 없는 기물은 기존 한자 말로 표시됨
const POSES = ['portrait', 'base', 'move', 'attack', 'hit', 'down'];
const D = 'assets/chars/chohan/';

export const THEMES = {
  chohan: {
    name: '초한지',
    cho: {
      k: { name: '항우', dir: D + 'cho_k/' },
      r: { name: '용저', dir: D + 'cho_r/' },
      c: { name: '종리매', dir: D + 'cho_c/' },
      n: { name: '계포', dir: D + 'cho_n/' },
      b: { name: '환초', dir: D + 'cho_b/' },
      a: { name: '범증', dir: D + 'cho_a/' },
      p: { name: '초나라 창병', dir: D + 'cho_p/' },
    },
    han: {
      k: { name: '유방', dir: D + 'han_k/' },
      r: { name: '한신', dir: D + 'han_r/' },
      c: { name: '주발', dir: D + 'han_c/' },
      n: { name: '관영', dir: D + 'han_n/' },
      b: { name: '번쾌', dir: D + 'han_b/' },
      a: { name: '장량', dir: D + 'han_a/' },
      p: { name: '한나라 병사', dir: D + 'han_p/' },
    },
  },
};

let theme = 'chohan';
export function setTheme(t) { if (THEMES[t]) theme = t; }

export function art(side, type) {
  const c = THEMES[theme]?.[side]?.[type];
  if (!c) return null;
  const o = { name: c.name };
  POSES.forEach((p) => (o[p] = c.dir + p + '.webp'));
  return o;
}

// 얼굴 이미지는 바로, 전신 포즈는 잠시 뒤 백그라운드로 불러오기
export function preload() {
  const t = THEMES[theme];
  const each = (fn) => ['cho', 'han'].forEach((s) => Object.keys(t[s]).forEach((k) => fn(art(s, k))));
  each((a) => { new Image().src = a.portrait; });
  setTimeout(() => each((a) => ['base', 'move', 'attack', 'hit', 'down'].forEach((p) => { new Image().src = a[p]; })), 1500);
}
