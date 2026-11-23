// 컴퓨터 상대 — Fairy-Stockfish(WebAssembly) + 급/단별 수 선택
// 수 선택 로직은 calib/calib.py 와 동일해야 보정 결과가 유효함
import { VARIANT } from './rules.js';

const MATE = 30000;

export function levelParams(x) {
  x = Math.max(0, Math.min(1, x));
  return {
    nodes: Math.round(50 * Math.pow(3000, x)),
    multipv: x < 0.85 ? 6 : x < 0.95 ? 3 : 1,
    temp: 150 * Math.pow(1 - x, 1.5),
    blunder: 0.65 * Math.pow(Math.max(0, 1 - x / 0.55), 1.3),
  };
}

export class Engine {
  constructor() { this.sf = null; this.listeners = []; this.mpv = null; this.busy = Promise.resolve(); }

  static supported() { return typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated !== false; }

  async init() {
    if (typeof Stockfish !== 'function') throw new Error('엔진 스크립트를 불러오지 못했습니다.');
    this.sf = await Stockfish();
    this.sf.addMessageListener((line) => this.listeners.forEach((fn) => fn(line)));
    await this.cmd('uci', 'uciok');
    this.sf.postMessage(`setoption name UCI_Variant value ${VARIANT}`);
    this.sf.postMessage('setoption name Threads value 1');
    this.sf.postMessage('setoption name Hash value 16');
    await this.cmd('isready', 'readyok');
  }

  cmd(text, until) {
    return new Promise((resolve) => {
      const fn = (l) => { if (l.startsWith(until)) { this.listeners = this.listeners.filter((x) => x !== fn); resolve(l); } };
      this.listeners.push(fn);
      this.sf.postMessage(text);
    });
  }

  async newGame() { this.sf.postMessage('ucinewgame'); await this.cmd('isready', 'readyok'); }

  // 한 번에 하나의 탐색만
  analyse(fen, moves, nodes, multipv) {
    const run = async () => {
      if (multipv !== this.mpv) { this.sf.postMessage(`setoption name MultiPV value ${multipv}`); this.mpv = multipv; }
      this.sf.postMessage(`position fen ${fen}` + (moves.length ? ' moves ' + moves.join(' ') : ''));
      const lines = {};
      const fn = (l) => {
        if (!l.startsWith('info') || l.indexOf(' pv ') < 0 || l.indexOf(' score ') < 0) return;
        const t = l.split(' ');
        const i = t.includes('multipv') ? +t[t.indexOf('multipv') + 1] : 1;
        const si = t.indexOf('score');
        const v = +t[si + 2];
        const sc = t[si + 1] === 'cp' ? v : (MATE - Math.abs(v)) * Math.sign(v);
        lines[i] = { move: t[t.indexOf('pv') + 1], score: sc };
      };
      this.listeners.push(fn);
      const best = (await this.cmd(`go nodes ${nodes}`, 'bestmove')).split(' ')[1];
      this.listeners = this.listeners.filter((x) => x !== fn);
      return { best, lines };
    };
    const p = this.busy.then(run);
    this.busy = p.catch(() => {});
    return p;
  }

  // 급/단 강도 x 에 맞춰 수 하나 선택
  async choose(fen, moves, legal, x) {
    const p = levelParams(x);
    if (Math.random() < p.blunder) {
      const nonpass = legal.filter((m) => { const a = /^([a-i]\d+)([a-i]\d+)$/.exec(m); return a && a[1] !== a[2]; });
      const pool = nonpass.length ? nonpass : legal;
      return pool[Math.floor(Math.random() * pool.length)];
    }
    const { best, lines } = await this.analyse(fen, moves, p.nodes, p.multipv);
    const cand = Object.keys(lines).sort((a, b) => a - b).map((k) => lines[k]);
    if (p.temp < 1 || cand.length <= 1) return best;
    const top = Math.max(...cand.map((c) => c.score));
    const w = cand.map((c) => Math.exp((c.score - top) / p.temp));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cand.length; i++) { r -= w[i]; if (r <= 0) return cand[i].move; }
    return cand[0].move;
  }
}

// 브라우저에서 엔진을 못 돌릴 때: 같은 엔진을 서버(/api/engine)에서 실행
export class RemoteEngine extends Engine {
  async init() {
    // 서버 엔진 깨우기 (첫 호출은 1~2초 걸림)
    await this.analyse('rnba1abnr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ABNR w - - 0 1', [], 50, 1);
  }
  async newGame() {}
  async analyse(fen, moves, nodes, multipv) {
    for (let tries = 0; tries < 3; tries++) {
      try {
        const r = await fetch('/api/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fen, moves, nodes, multipv }) });
        if (r.ok) return await r.json();
      } catch (e) { /* 재시도 */ }
      await new Promise((ok) => setTimeout(ok, 600));
    }
    throw new Error('서버 엔진에 연결하지 못했습니다.');
  }
}
