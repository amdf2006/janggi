// 장기 규칙 모듈 — Fairy-Stockfish(ffish.js)를 감싸서 합법수·장군·승패를 판정
import Module from '../lib/ffish.js';

let ff = null;
export async function initRules() {
  if (!ff) ff = await Module({ locateFile: (f) => new URL('../lib/' + f, import.meta.url).href });
  return ff;
}

export const VARIANT = 'janggi';
export const FILES = 'abcdefghi';

// 상차림: 자기 시점 왼쪽→오른쪽 (마=N, 상=B)
export const SETUPS = [
  { id: 'NBBN', name: '마상상마' },
  { id: 'BNNB', name: '상마마상' },
  { id: 'NBNB', name: '마상마상' },
  { id: 'BNBN', name: '상마상마' },
];

export function makeFen(choSetup, hanSetup) {
  const rank = (s) => 'R' + s[0] + s[1] + 'A1A' + s[2] + s[3] + 'R';
  const w = rank(choSetup);
  const b = rank(hanSetup).split('').reverse().join('').toLowerCase();
  return `${b}/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/${w} w - - 0 1`;
}

// 기물 정보
export const PIECES = {
  k: { ko: '궁', cho: '楚', han: '漢', pts: 0, size: 'l' },
  r: { ko: '차', cho: '車', han: '車', pts: 13, size: 'm' },
  c: { ko: '포', cho: '包', han: '包', pts: 7, size: 'm' },
  n: { ko: '마', cho: '馬', han: '馬', pts: 5, size: 'm' },
  b: { ko: '상', cho: '象', han: '象', pts: 3, size: 'm' },
  a: { ko: '사', cho: '士', han: '士', pts: 3, size: 's' },
  p: { ko: '졸', cho: '卒', han: '兵', pts: 2, size: 's' },
};
export const HAN_BONUS = 1.5; // 한(후수) 덤

export function parseMove(uci) {
  const m = /^([a-i])(\d+)([a-i])(\d+)$/.exec(uci);
  if (!m) return null;
  return { from: m[1] + m[2], to: m[3] + m[4], ff: FILES.indexOf(m[1]), fr: +m[2] - 1, tf: FILES.indexOf(m[3]), tr: +m[4] - 1, pass: m[1] === m[3] && m[2] === m[4] };
}

// FEN → 칸별 기물 맵 { 'e2': {type:'k', side:'cho'} }
export function boardMap(fen) {
  const rows = fen.split(' ')[0].split('/');
  const map = {};
  rows.forEach((row, i) => {
    const rank = 10 - i; // 첫 줄 = 10단
    let f = 0;
    const re = /(\d+)|([a-zA-Z])/g;
    let t;
    while ((t = re.exec(row))) {
      if (t[1]) f += +t[1];
      else {
        const ch = t[2];
        map[FILES[f] + rank] = { type: ch.toLowerCase(), side: ch === ch.toUpperCase() ? 'cho' : 'han' };
        f++;
      }
    }
  });
  return map;
}

export class Game {
  constructor(choSetup, hanSetup) {
    this.startFen = makeFen(choSetup, hanSetup);
    this.board = new ff.Board(VARIANT, this.startFen);
    this.moves = [];
    this.captured = { cho: [], han: [] }; // 각 진영이 '잡은' 기물
  }
  destroy() { this.board.delete(); }
  fen() { return this.board.fen(); }
  turn() { return this.board.turn() ? 'cho' : 'han'; }
  legal() { const s = this.board.legalMoves(); return s ? s.split(' ') : []; }
  isCheck() { return this.board.isCheck(); }
  isCapture(m) { return this.board.isCapture(m); }
  map() { return boardMap(this.fen()); }

  push(m) {
    const before = this.map();
    const mv = parseMove(m);
    const victim = !mv.pass ? before[mv.to] : null;
    const mover = this.turn();
    this.board.push(m);
    this.moves.push({ uci: m, victim, mover, piece: before[mv.from]?.type });
    if (victim) this.captured[mover].push(victim.type);
  }
  pop() {
    const last = this.moves.pop();
    if (!last) return;
    this.board.pop();
    if (last.victim) this.captured[last.mover].pop();
  }

  score(side) {
    // 판 위에 남은 기물 점수 (한은 덤 포함)
    const map = this.map();
    let s = side === 'han' ? HAN_BONUS : 0;
    for (const k in map) if (map[k].side === side) s += PIECES[map[k].type].pts;
    return s;
  }

  // 종료 판정 → null 또는 { winner:'cho'|'han'|null, reason }
  outcome() {
    if (!this.board.isGameOver(true)) return null;
    const r = this.board.result(true);
    const winner = r === '1-0' ? 'cho' : r === '0-1' ? 'han' : null;
    let reason = '규칙에 따른 종료';
    const n = this.moves.length;
    const lastTwoPass = n >= 2 && parseMove(this.moves[n - 1].uci).pass && parseMove(this.moves[n - 2].uci).pass;
    if (this.legal().length === 0 && this.isCheck()) reason = '외통';
    else if (this.board.isBikjang()) reason = '빅장';
    else if (lastTwoPass) reason = '양측 한수쉼 — 점수 판정';
    else if (this.legal().length === 0) reason = '둘 수 있는 수 없음';
    return { winner, reason };
  }

  // 기보 표기: "마 b1→c3", 한수쉼
  label(i) {
    const m = this.moves[i];
    const mv = parseMove(m.uci);
    if (mv.pass) return '한수쉼';
    const name = PIECES[m.piece]?.ko ?? '';
    return `${name} ${mv.from}→${mv.to}` + (m.victim ? ` ×${PIECES[m.victim.type].ko}` : '');
  }
}
