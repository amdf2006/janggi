#!/usr/bin/env python3
"""
보정 측정값(run*.json) → 27단계 급/단 강도 x 값 → js/levels.js 생성
목표 간격(한게임 승강급 기준 승률을 Elo로 환산):
  18급→11급: 승률 60%  ≈  70 Elo
  11급→1급 : 승률 66%  ≈ 115 Elo
  1급→5단  : 승률 69%  ≈ 139 Elo
  5단→9단  : 승률 70%  ≈ 147 Elo
9단 = 최고 강도(x=1)에 고정하고 아래로 내려가며 배치
"""
import json, math, sys, glob

def elo(s):
    s = min(0.97, max(0.03, s)); return -400 * math.log10(1 / s - 1)

# 측정값 모으기: (약한 x, 강한 x) → elo 차이 (같은 구간 여러 번이면 판수 가중 평균)
pairs = {}
for f in sys.argv[1:]:
    for r in json.load(open(f)):
        k = (round(r['weak'], 4), round(r['strong'], 4))
        a = pairs.setdefault(k, [0, 0.0]); a[0] += r['games']; a[1] += r['score'] * r['games']

# 가장 촘촘한 경로로 체인 구성: 짧은 구간 우선
segs = sorted(pairs.items(), key=lambda kv: kv[0][0])
pts = {0.0: 0.0}
xs_all = sorted(set([k[0] for k in pairs] + [k[1] for k in pairs]))
# 동적계획: 0에서 각 점까지 가장 세밀한(구간 수 많은) 경로
best = {0.0: (0, 0.0)}
for x in xs_all:
    if x not in best: continue
    for (w, s), (g, tot) in pairs.items():
        if w == x:
            cand = (best[x][0] + 1, best[x][1] + elo(tot / g))
            if s not in best or cand[0] > best[s][0]:
                best[s] = cand
curve = sorted((x, v[1]) for x, v in best.items())
print('측정 곡선 (x, 누적Elo):'); [print(f'  {x:.3f}  {e:7.1f}') for x, e in curve]

def x_at(e):
    for (x0, e0), (x1, e1) in zip(curve, curve[1:]):
        if e0 <= e <= e1:
            return x0 + (x1 - x0) * (e - e0) / (e1 - e0) if e1 > e0 else x0
    return curve[0][0] if e < curve[0][1] else curve[-1][0]

names = [f'{18 - i}급' for i in range(18)] + [f'{i + 1}단' for i in range(9)]
gaps = [70] * 7 + [115] * 10 + [139] * 5 + [147] * 4   # 26개 간격 (18급→9단)
total = sum(gaps); top = curve[-1][1]; span = top - curve[0][1]
scale = min(1.0, span / total)
print(f'목표 총폭 {total} Elo, 측정 총폭 {span:.0f} Elo, 축소비 {scale:.3f}')
target = [top]
for g in reversed(gaps): target.append(target[-1] - g * scale)
target = list(reversed(target))

def desc(i):
    if i < 6: return '규칙을 막 익힌 초보'
    if i < 12: return '말 교환을 아는 입문자'
    if i < 18: return '몇 수 앞을 읽는 중급'
    if i < 21: return '온라인 유단자'
    if i < 24: return '대회권 고수'
    return '최상위 아마추어'

levels = [dict(name=n, x=round(x_at(e), 4), elo=round(e - target[0]), desc=desc(i)) for i, (n, e) in enumerate(zip(names, target))]
for l in levels: print(f"  {l['name']:>4}  x={l['x']:.4f}  상대Elo={l['elo']}")
js = '// 자동 생성: calib/make_levels.py — 직접 수정하지 마세요\n'
js += '// x = 엔진 강도 노브(0~1), elo = 18급 대비 상대 Elo(측정 기반)\n'
js += 'export const LEVELS = ' + json.dumps([{k: l[k] for k in ('name', 'x', 'desc')} for l in levels], ensure_ascii=False, indent=1) + ';\n'
open('/home/claude/janggi/js/levels.js', 'w').write(js)
json.dump(levels, open('/home/claude/calib/levels.json', 'w'), ensure_ascii=False, indent=1)
