#!/usr/bin/env python3
"""
CPU 강도 보정(Calibration) 스크립트
- 웹 게임(js/ai.js)과 똑같은 수 선택 로직을 네이티브 Fairy-Stockfish로 재현
- 강도 노브 x(0~1) 샘플 지점끼리 인접 대국 → 승률 → Elo 차이 측정
사용: python3 calib.py <engine_path> <games_per_pair> <out.json>
"""
import sys, json, math, random, subprocess, time
import pyffish as sf

V = 'janggi'
SETUPS = ['NBBN', 'BNNB', 'NBNB', 'BNBN']  # 마상상마, 상마마상, 마상마상, 상마상마 (왼→오, 자기 시점)
MATE = 30000


def params(x):
    """강도 노브 x → 엔진 파라미터. js/ai.js 의 levelParams 와 동일해야 함."""
    x = max(0.0, min(1.0, x))
    nodes = int(round(50 * (3000 ** x)))
    multipv = 6 if x < 0.85 else (3 if x < 0.95 else 1)
    temp = 150 * (1 - x) ** 1.5
    blunder = 0.65 * max(0.0, 1 - x / 0.55) ** 1.3
    return dict(nodes=nodes, multipv=multipv, temp=temp, blunder=blunder)


def make_fen(cho_setup, han_setup):
    def rank(s):
        n1, b1, b2, n2 = s  # 왼쪽 두 칸, 오른쪽 두 칸
        return 'R' + n1 + b1 + 'A1A' + b2 + n2 + 'R'
    w = rank(cho_setup)
    b = rank(han_setup)[::-1].lower()  # 한은 반대편에서 보므로 좌우 반전
    return f"{b}/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/{w} w - - 0 1"


class Engine:
    def __init__(self, path):
        self.p = subprocess.Popen([path], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  universal_newlines=True, bufsize=1)
        self.send('uci'); self.wait('uciok')
        self.send(f'setoption name UCI_Variant value {V}')
        self.send('setoption name Threads value 1')
        self.send('setoption name Hash value 16')
        self.send('isready'); self.wait('readyok')
        self.mpv = None

    def send(self, s):
        self.p.stdin.write(s + '\n')

    def wait(self, tok):
        while True:
            l = self.p.stdout.readline()
            if l.startswith(tok):
                return l

    def analyse(self, fen, moves, nodes, multipv):
        if multipv != self.mpv:
            self.send(f'setoption name MultiPV value {multipv}'); self.mpv = multipv
        self.send(f"position fen {fen}" + (" moves " + " ".join(moves) if moves else ""))
        self.send(f'go nodes {nodes}')
        lines = {}
        while True:
            l = self.p.stdout.readline().strip()
            if l.startswith('bestmove'):
                best = l.split()[1]
                break
            if l.startswith('info') and ' pv ' in l and ' score ' in l:
                t = l.split()
                i = int(t[t.index('multipv') + 1]) if 'multipv' in t else 1
                si = t.index('score')
                kind, val = t[si + 1], int(t[si + 2])
                sc = val if kind == 'cp' else (MATE - abs(val)) * (1 if val > 0 else -1)
                mv = t[t.index('pv') + 1]
                lines[i] = (mv, sc)
        return best, lines

    def newgame(self):
        self.send('ucinewgame'); self.send('isready'); self.wait('readyok')


def choose(eng, fen, moves, x, rng):
    p = params(x)
    legal = sf.legal_moves(V, fen, moves)
    if not legal:
        return None
    if rng.random() < p['blunder']:
        # 실수: 아무 수나 (단, 한수쉼은 덜 고르게)
        nonpass = [m for m in legal if m[:2] != m[2:]] or legal
        return rng.choice(nonpass)
    best, lines = eng.analyse(fen, moves, p['nodes'], p['multipv'])
    if p['temp'] < 1 or len(lines) <= 1:
        return best
    cand = [lines[k] for k in sorted(lines)]
    top = max(s for _, s in cand)
    w = [math.exp((s - top) / p['temp']) for _, s in cand]
    r = rng.random() * sum(w)
    for (m, _), wi in zip(cand, w):
        r -= wi
        if r <= 0:
            return m
    return cand[0][0]


def play(eng, xa, xb, a_is_cho, rng, max_plies=int(__import__('os').environ.get('MAXP','240'))):
    fen = make_fen(rng.choice(SETUPS), rng.choice(SETUPS))
    moves = []
    eng.newgame()
    while True:
        end, res = sf.is_immediate_game_end(V, fen, moves)
        if not end:
            end, res = sf.is_optional_game_end(V, fen, moves)
        legal = sf.legal_moves(V, fen, moves)
        if not end and not legal:
            end, res = True, sf.game_result(V, fen, moves)
        cho_to_move = len(moves) % 2 == 0
        if end:
            # res 는 둘 차례 기준
            if res == 0:
                return 0.5
            mover_wins = res > 0
            cho_wins = mover_wins == cho_to_move
            return 1.0 if cho_wins == a_is_cho else 0.0
        if len(moves) >= max_plies:
            _, lines = eng.analyse(fen, moves, 20000, 1)
            sc = lines.get(1, ('', 0))[1]
            if abs(sc) < 250:
                return 0.5
            cho_better = (sc > 0) == cho_to_move
            return 1.0 if cho_better == a_is_cho else 0.0
        x = xa if (cho_to_move == a_is_cho) else xb
        moves.append(choose(eng, fen, moves, x, rng))


def elo(score):
    s = min(0.97, max(0.03, score))
    return -400 * math.log10(1 / s - 1)


def main():
    path, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    xs = [float(v) for v in sys.argv[4].split(',')] if len(sys.argv) > 4 else \
        [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    eng = Engine(path)
    rng = random.Random(7)
    results = []
    for a, b in zip(xs[1:], xs[:-1]):  # a = 강한 쪽
        t0 = time.time(); tot = 0
        games = n if a < 0.75 else max(12, n // 2)
        for g in range(games):
            tot += play(eng, a, b, g % 2 == 0, rng)
        sc = tot / games
        r = dict(strong=a, weak=b, games=games, score=sc, elo_gap=elo(sc), sec=round(time.time() - t0))
        results.append(r)
        print(json.dumps(r), flush=True)
        json.dump(results, open(out, 'w'), indent=1)


if __name__ == '__main__':
    main()
