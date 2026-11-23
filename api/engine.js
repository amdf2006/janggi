// 서버 엔진 — 브라우저에서 엔진을 못 돌리는 기기(일부 안드로이드·앱 내 브라우저)용
// 브라우저와 같은 Fairy-Stockfish WASM 을 그대로 써서 급수 보정이 똑같이 유지됨
const path = require('path');

let sf = null, ready = null, listeners = [], queue = Promise.resolve(), mpv = null;
const LIB = path.join(__dirname, '..', 'lib');

function cmd(text, until) {
  return new Promise((resolve) => {
    const fn = (l) => { if (l.startsWith(until)) { listeners = listeners.filter((x) => x !== fn); resolve(l); } };
    listeners.push(fn); sf.postMessage(text);
  });
}

function init() {
  if (ready) return ready;
  ready = (async () => {
    const savedFetch = globalThis.fetch;
    delete globalThis.fetch; // 구형 emscripten이 node에서 fetch로 wasm을 읽으려는 문제 회피
    const Stockfish = require(path.join(LIB, 'stockfish.js'));
    sf = await Stockfish({ locateFile: (f) => path.join(LIB, f) });
    if (savedFetch) globalThis.fetch = savedFetch;
    sf.addMessageListener((l) => listeners.forEach((fn) => fn(l)));
    await cmd('uci', 'uciok');
    sf.postMessage('setoption name UCI_Variant value janggi');
    sf.postMessage('setoption name Threads value 1');
    sf.postMessage('setoption name Hash value 16');
    await cmd('isready', 'readyok');
  })();
  return ready;
}

const MATE = 30000;
async function analyse(fen, moves, nodes, multipv) {
  if (multipv !== mpv) { sf.postMessage(`setoption name MultiPV value ${multipv}`); mpv = multipv; }
  sf.postMessage(`position fen ${fen}` + (moves.length ? ' moves ' + moves.join(' ') : ''));
  const lines = {};
  const fn = (l) => {
    if (!l.startsWith('info') || l.indexOf(' pv ') < 0 || l.indexOf(' score ') < 0) return;
    const t = l.split(' ');
    const i = t.includes('multipv') ? +t[t.indexOf('multipv') + 1] : 1;
    const si = t.indexOf('score'); const v = +t[si + 2];
    lines[i] = { move: t[t.indexOf('pv') + 1], score: t[si + 1] === 'cp' ? v : (MATE - Math.abs(v)) * Math.sign(v) };
  };
  listeners.push(fn);
  const best = (await cmd(`go nodes ${nodes}`, 'bestmove')).split(' ')[1];
  listeners = listeners.filter((x) => x !== fn);
  return { best, lines };
}

const FEN_RE = /^[rnbakcpRNBAKCP1-9\/]+ [wb] - - \d+ \d+$/;
const MOVE_RE = /^[a-i]\d{1,2}[a-i]\d{1,2}$/;

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
    let body = req.body;
    if (!body || typeof body === 'string') body = JSON.parse(body || '{}');
    const { fen, moves = [], nodes = 1000, multipv = 1 } = body;
    if (!FEN_RE.test(fen) || !Array.isArray(moves) || moves.length > 600 || !moves.every((m) => MOVE_RE.test(m))) {
      res.statusCode = 400; return res.end('bad position');
    }
    const n = Math.max(10, Math.min(200000, nodes | 0));
    const k = Math.max(1, Math.min(6, multipv | 0));
    await init();
    const job = queue.then(() => analyse(fen, moves, n, k));
    queue = job.catch(() => {});
    const out = await job;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 500; res.end(String(e && e.message || e));
  }
};
