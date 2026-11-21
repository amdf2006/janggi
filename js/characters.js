// 캐릭터 아트 목록 — 테마별, 진영(cho/han)별, 기물(k,r,c,n,b,a,p)별
// 그림이 없는 기물은 기존 한자 말로 표시됨
const POSES = ['portrait', 'base', 'move', 'attack', 'hit', 'down'];

export const THEMES = {
  chohan: {
    name: '초한지',
    cho: { k: { name: '항우', dir: 'assets/chars/chohan/cho_k/' } },
    han: {},
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

// 미리 불러오기 (전투 중 깜빡임 방지)
export function preload() {
  const t = THEMES[theme];
  ['cho', 'han'].forEach((s) => Object.keys(t[s]).forEach((k) => {
    const a = art(s, k);
    POSES.forEach((p) => { const i = new Image(); i.src = a[p]; });
  }));
}
