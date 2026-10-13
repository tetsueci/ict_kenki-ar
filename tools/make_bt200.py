# -*- coding: utf-8 -*-
"""TADANO BT-200（橋梁点検車）の部品メッシュを、カタログの数字から作る。

  ★この機械だけは 3D データが無い。あるのはカタログ 1 枚だけ
    （DAM/kenki/doc_tadano_bt-200_bt-110_bt-400_lineup_brochure_metric.pdf）。
    ほかの機械は図面のブロックから出しているが、これは**箱で組む**。
    寸法の出どころは DAM/kenki/BT-200_params.md。

  ★部品の原点と向きは、ほかの機械と同じ決まりにする:
      原点 = その部品の回転・伸縮の基点、+x = 部品が伸びる向き、z = 上。
    単位はミリ。アプリ側が CAD → three.js の変換をまとめて掛ける。

  使い方:
    python tools/make_bt200.py models/TADANO_BT200
"""
import io, os, sys, json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _find_glb_tools():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(6):
        d = os.path.dirname(d)
        cand = os.path.join(d, "ict_ar-viewer", "tools")
        if os.path.isfile(os.path.join(cand, "glb.py")):
            return cand
    raise SystemExit("ict_ar-viewer/tools/glb.py が見つからない")


sys.path.insert(0, _find_glb_tools())
from glb import write_glb                                    # noqa: E402

BODY = (0.62, 0.66, 0.70, 1.0)
GLASS = (0.68, 0.80, 0.86, 0.30)

# 箱 1 つ = 12 三角形
#   ★面の回り順は「外から見て反時計回り」。逆にすると法線が内を向き、
#     手前の面が真っ黒＝透けて見える（2026-10-13 に指摘された）
_BOX_T = np.array([
    [0, 2, 1], [0, 3, 2],          # 下（-z）
    [4, 5, 6], [4, 6, 7],          # 上（+z）
    [0, 1, 5], [0, 5, 4],          # -y
    [1, 2, 6], [1, 6, 5],          # +x
    [2, 3, 7], [2, 7, 6],          # +y
    [3, 0, 4], [3, 4, 7]], dtype=np.int64)   # -x


def box(x0, y0, z0, x1, y1, z1):
    v = np.array([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
                  [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
                 dtype=np.float64)
    return v, _BOX_T.copy()


def merge(parts):
    """[(v, t), ...] を 1 つにまとめる"""
    V, T, n = [], [], 0
    for v, t in parts:
        V.append(v); T.append(t + n); n += len(v)
    return np.concatenate(V), np.concatenate(T)


def tube(length, w, h, wall=60.0):
    """角パイプ（中空に見えるように端を開けない。外側の箱だけ）"""
    return box(0.0, -w / 2, -h / 2, length, w / 2, h / 2)


def prism(x0, x1, w0, h0, w1, h1, dz0=0.0, dz1=0.0):
    """x0 から x1 へ、両端の断面を変えられる角柱。
       ★外観図を見ると、ブームもポストも先へ行くほど細くなっている
         （2026-10-13 のご指示「アームの形状を細かく」）"""
    a, b, c, d = w0 / 2, h0 / 2, w1 / 2, h1 / 2
    v = np.array([[x0, -a, -b + dz0], [x1, -c, -d + dz1], [x1, c, -d + dz1], [x0, a, -b + dz0],
                  [x0, -a, b + dz0], [x1, -c, d + dz1], [x1, c, d + dz1], [x0, a, b + dz0]],
                 dtype=np.float64)
    # box() と同じ頂点の並びに合わせる（0-3 が下、4-7 が上）
    return v, _BOX_T.copy()


# ---------------------------------------------------------------------
# ユニック（icon_kenki\cargo.dwg の 3D部品1）から運転席と車輪を借りる
#   ★「もう少しトラックらしく」というご指示（2026-10-13）。
#     BT-200 の 3D データは無いので、同じ小型トラックの運転席を借りる。
#     元データは BRIDGE で吸い出した DAM/kenki/work/cargo/cargo1.txt
#     （git の外。無ければ下の箱だけで組む）。
#   ★全長だけ BT-200 に合わせて x を縮める（6190 → 5750）。
#     車輪は丸いままにしたいので縮めず、カタログの軸距・輪距へ置き直す。
# ---------------------------------------------------------------------
CARGO = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "..", "..", "DAM", "kenki", "work", "cargo", "cargo1.txt")


def read_dump(path):
    """BRIDGE が書いたポリフェイスメッシュのダンプ → (頂点, 三角形)"""
    V, T, base = [], [], 0
    for ln in io.open(path, encoding="utf-8"):
        a = ln.split()
        if not a:
            continue
        if a[0] == "m":
            base = len(V)
        elif a[0] == "v":
            V.append([float(a[1]), float(a[2]), float(a[3])])
        elif a[0] == "f":
            q = [base + int(x) - 1 for x in a[1:5] if int(x) > 0]
            if len(q) >= 3:
                T.append([q[0], q[1], q[2]])
                if len(q) == 4:
                    T.append([q[0], q[2], q[3]])
    return np.asarray(V), np.asarray(T)


def clusters(v, t):
    uq, inv = np.unique(np.round(v, 2), axis=0, return_inverse=True)
    tt = inv[t]
    par = np.arange(int(tt.max()) + 1)

    def find(a):
        r = a
        while par[r] != r:
            r = par[r]
        while par[a] != r:
            par[a], a = r, par[a]
        return r
    for tri in tt:
        for x, y in ((tri[0], tri[1]), (tri[1], tri[2])):
            p_, q_ = find(x), find(y)
            if p_ != q_:
                par[p_] = q_
    g = {}
    for i, tri in enumerate(tt):
        g.setdefault(find(tri[0]), []).append(i)
    out = [(np.array(ix), np.unique(t[np.array(ix)])) for ix in g.values()]
    out.sort(key=lambda a: -len(a[0]))
    return out


def cargo_truck():
    """(運転席＋シャシ, 車輪 1 つ) を BT-200 の車体座標で返す。無ければ None"""
    if not os.path.isfile(CARGO):
        return None
    v, t = read_dump(CARGO)
    cl = clusters(v, t)
    cab_i, cab_v = cl[0]                      # いちばん大きい＝運転席＋シャシ
    wheels = [c for c in cl if len(c[0]) == 308]
    if not wheels:
        return None
    # --- 運転席＋シャシ ---
    p = v[cab_v]
    x0, x1 = p[:, 0].min(), p[:, 0].max()     # 前端 .. 後端（ユニックは +x が後ろ）
    yc = (p[:, 1].min() + p[:, 1].max()) / 2
    # ★地面は「車輪のいちばん下」。運転席のかたまりの下端にすると
    #   車輪が 255mm 地面へめり込む（2026-10-13 に描いて気づいた）
    z0 = min(v[w[1]][:, 2].min() for w in wheels)
    k = 5750.0 / (x1 - x0)                    # 全長を BT-200 に合わせる
    def conv(q):
        # ユニックの +x（前→後）→ BT-200 の -y、ユニックの +y → BT-200 の +x
        return np.c_[q[:, 1] - yc,
                     FRONT_END - (q[:, 0] - x0) * k,
                     q[:, 2] - z0]
    idx = {int(a): i for i, a in enumerate(cab_v)}
    cab = (conv(v[cab_v]), np.vectorize(idx.get)(t[cab_i]))
    # --- 車輪 1 つ（丸いまま使う。縮めない）---
    wi, wv = wheels[0]
    q = v[wv]
    c = (q.min(axis=0) + q.max(axis=0)) / 2
    idx = {int(a): i for i, a in enumerate(wv)}
    wheel = (np.c_[q[:, 1] - c[1], -(q[:, 0] - c[0]), q[:, 2] - z0],
             np.vectorize(idx.get)(t[wi]))
    return cab, wheel


# ---------------------------------------------------------------------
# 車体（トラック 3.5t 車クラス）
#   ★旋回中心を原点にする。車両の長手は y（+y が前）、+x はブームが出る側。
#     全長 5750 / 全幅 2180 / ホイールベース 2795 /
#     フロントオーバーハング 1110 / リヤオーバーハング 1845 /
#     トレッド フロント 1680・リヤ 1525（すべてカタログ）
#   ★旋回中心の車両方向の位置はカタログから決まらない。
#     後軸より前 300mm と置いた → BT-200_params.md §7
# ---------------------------------------------------------------------
REAR_AXLE = -300.0
FRONT_AXLE = REAR_AXLE + 2795.0
FRONT_END = FRONT_AXLE + 1110.0          # = 3605
REAR_END = REAR_AXLE - 1845.0            # = -2145
TREAD_F, TREAD_R = 1680.0, 1525.0


def make_body():
    W = 1090.0
    got = cargo_truck()
    p = []
    if got:
        cab, wheel = got
        p.append(cab)
        for (ax, tr) in ((FRONT_AXLE, TREAD_F), (REAR_AXLE, TREAD_R)):
            for sx in (-1, 1):
                v, t = wheel
                p.append((v + np.array([sx * tr / 2, ax, 0.0]), t))
    else:
        # ユニックのダンプが無いときは箱で代用
        p.append(box(-W, REAR_END, 400, W, FRONT_END, 900))
        p.append(box(-W + 60, FRONT_AXLE - 600, 900, W - 60, FRONT_END, 2180))
        for (ax, tr) in ((FRONT_AXLE, TREAD_F), (REAR_AXLE, TREAD_R)):
            for sx in (-1, 1):
                p.append(box(sx * tr / 2 - 120, ax - 380, 0,
                             sx * tr / 2 + 120, ax + 380, 760))
    # 架装部（ポンプ・タンクなど）。ここは BT-200 のもの
    p.append(box(-W + 40, REAR_END + 200, 900, W - 40, 900, 1500))
    return merge(p)


def make_outrigger():
    """アウトリガ 1 本。原点＝車体側の付け根、+x が張り出す向き"""
    p = [box(0, -120, -120, 1500, 120, 120),               # スライドビーム
         box(1300, -160, -900, 1620, 160, 120)]            # ジャッキ
    return merge(p)


def make_outrigger_foot():
    return box(-220, -220, -120, 220, 220, 60)             # 接地板


# ---------------------------------------------------------------------
# 旋回台。原点＝旋回中心（地面）。z 1190 から上
# ---------------------------------------------------------------------
def make_turret():
    p = [box(-420, -480, 1070, 420, 480, 1200)]           # ベアリング座
    # 柱は上へ細くする（外観図の旋回台がそう見える）
    v, t = prism(1200.0, 2710.0, 800.0, 900.0, 560.0, 620.0)
    # ★+x を上へ向け直す。y 軸まわりの回転 (x,y,z) -> (-z,y,x)。
    #   座標を入れ替えるだけだと鏡になって面が裏返る（透けて見える）
    p.append((np.c_[-v[:, 2], v[:, 1], v[:, 0]], t))
    p.append(box(-330, -430, 2560, 330, 430, 2880))        # ブーム取付部
    return merge(p)


# ---------------------------------------------------------------------
# ブーム（2 段）。原点＝フートピン、+x が伸びる向き
#   長さ 3.06m〜5.11m（ストローク 2.05m）
# ---------------------------------------------------------------------
BOOM_LEN = 3060.0
BOOM_STROKE = 2050.0


BOOM_W = [(460.0, 400.0), (390.0, 330.0)]   # 各段の 根元 → 先端 の見付け


def make_boom(i):
    """★外観図の格納姿勢で測ったブームの厚み（おおむね 400〜550mm）に合わせた。
       先端は鼻先を斜めに落とす"""
    w0, w1 = BOOM_W[i]
    nose = 260.0
    p = [prism(0.0, BOOM_LEN - nose, w0, w0, w1, w1)]
    # 鼻先：上側だけ落とす
    p.append(prism(BOOM_LEN - nose, BOOM_LEN, w1, w1, w1 * 0.8, w1 * 0.55,
                   0.0, -w1 * 0.1))
    if i == 0:            # 根元のピン座（耳）
        p.append(box(-120.0, -w0 / 2 - 50, -w0 / 2, 180.0, w0 / 2 + 50, w0 / 2))
    return merge(p)


# ---------------------------------------------------------------------
# ポスト（5 段）。原点＝各段の上端、+x は下向きに伸びる向き（鉛直）
#   全長 3.325m〜9.825m（ストローク 6.5m ＝ 1.625m × 4 段）
# ---------------------------------------------------------------------
POST_LEN = 3325.0
POST_STEP = 1625.0
POST_W = [650.0, 560.0, 470.0, 380.0, 300.0]


def make_post(i):
    """★外観図で測ると、いちばん外の段の見付けは 654mm（作業範囲図の 650 と一致）。
       格納姿勢では天端の角が斜めに落としてあるので、それも入れる"""
    w = POST_W[i]
    ch = 190.0 if i == 0 else 0.0        # 天端の面取り（外観図で実測）
    p = []
    if ch > 0:
        p.append(prism(0.0, ch, w * 0.62, w, w, w, 0.0, 0.0))
        p.append(prism(ch, POST_LEN, w, w, w, w))
    else:
        p.append(prism(0.0, POST_LEN, w, w, w, w))
    return merge(p)


# ---------------------------------------------------------------------
# デッキブーム（3 段同時伸縮）。原点＝ポスト下端、+x が伸びる向き
#   長さ 3.5m〜8.21m（ストローク 4.71m ＝ 2.355m × 2 段）
# ---------------------------------------------------------------------
DBOOM_LEN = 3500.0
DBOOM_STEP = 2355.0


def make_deckboom(i):
    w0 = 420.0 - i * 60.0
    return prism(0.0, DBOOM_LEN, w0, w0 * 0.95, w0 * 0.92, w0 * 0.88)


# ---------------------------------------------------------------------
# デッキ（作業床）3.0m × 0.85m、手すり 0.9m
#   原点＝デッキの旋回中心（床の高さ）。+x は床の長手
# ---------------------------------------------------------------------
def make_deck():
    L, W, H, r = 3000.0, 850.0, 900.0, 50.0
    p = [box(-L / 2, -W / 2, -100, L / 2, W / 2, 0)]       # 床
    for y in (-W / 2, W / 2 - r):                           # 長手の手すり
        p.append(box(-L / 2, y, H - r, L / 2, y + r, H))
        p.append(box(-L / 2, y, H / 2 - r / 2, L / 2, y + r, H / 2 + r / 2))
    for x in (-L / 2, L / 2 - r):                           # 短手の手すり
        p.append(box(x, -W / 2, H - r, x + r, W / 2, H))
    for x in (-L / 2, -L / 6, L / 6, L / 2 - r):            # 支柱
        for y in (-W / 2, W / 2 - r):
            p.append(box(x, y, 0, x + r, y + r, H))
    return merge(p)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "models/TADANO_BT200"
    os.makedirs(out, exist_ok=True)
    parts = {"body": make_body(), "turret": make_turret(),
             "outrigger": make_outrigger(), "outrigger-foot": make_outrigger_foot(),
             "deck": make_deck()}
    for i in range(2):
        parts["boom%d" % i] = make_boom(i)
    for i in range(5):
        parts["post%d" % i] = make_post(i)
    for i in range(3):
        parts["deckboom%d" % i] = make_deckboom(i)

    index = {}
    for name, (v, t) in sorted(parts.items()):
        p = os.path.join(out, name + ".glb")
        write_glb(p, {BODY: (v, t)}, name=name)
        lo, hi = v.min(axis=0), v.max(axis=0)
        index[name] = {"file": name + ".glb", "tris": int(len(t)),
                       "min": [round(float(x), 2) for x in lo],
                       "max": [round(float(x), 2) for x in hi]}
        print("  %-14s 三角形 %5d  %7.0f x %7.0f x %7.0f mm"
              % (name, len(t), hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]))
    io.open(os.path.join(out, "_parts.json"), "w", encoding="utf-8",
            newline="\n").write(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    print("\n部品 %d / 三角形 %d" % (len(index), sum(x["tris"] for x in index.values())))


if __name__ == "__main__":
    main()
