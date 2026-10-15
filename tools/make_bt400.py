# -*- coding: utf-8 -*-
"""TADANO BT-400（橋梁点検車）の部品メッシュを、カタログの数字から作る。

  ★この機械も 3D データが無い。あるのはカタログ 1 枚だけ
    （DAM/kenki/doc_tadano_bt-200_bt-110_bt-400_lineup_brochure_metric.pdf 9〜10 頁）。
    寸法の出どころと検算は DAM/kenki/BT-400_params.md。

  ★部品の原点と向きは、ほかの機械と同じ決まり:
      原点 = その部品の回転・伸縮の基点、+x = 部品が伸びる向き、z = 上。単位はミリ。
    車体だけは 原点 = 旋回中心・地面、+y = 車両の前、+x = 車両の右。

  使い方:
    python tools/make_bt400.py models/TADANO_BT400
"""
import io
import os
import sys
import json

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

# 箱 1 つ = 12 三角形
#   ★面の回り順は「外から見て反時計回り」。逆にすると法線が内を向き、
#     手前の面が真っ黒＝透けて見える（BT-200 で指摘された）
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


def prism(x0, x1, w0, h0, w1, h1, dz0=0.0, dz1=0.0):
    """x0 から x1 へ、両端の断面を変えられる角柱（先へ細くするのに使う）"""
    a, b, c, d = w0 / 2, h0 / 2, w1 / 2, h1 / 2
    v = np.array([[x0, -a, -b + dz0], [x1, -c, -d + dz1], [x1, c, -d + dz1], [x0, a, -b + dz0],
                  [x0, -a, b + dz0], [x1, -c, d + dz1], [x1, c, d + dz1], [x0, a, b + dz0]],
                 dtype=np.float64)
    return v, _BOX_T.copy()


def merge(parts):
    V, T, n = [], [], 0
    for v, t in parts:
        V.append(v)
        T.append(t + n)
        n += len(v)
    return np.concatenate(V), np.concatenate(T)


def signed_volume(v, t):
    """面の向きの検算。外向きなら正（BT-200 で裏返しを出したので毎回見る）"""
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    return float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6.0)


# =====================================================================
# 車体（25t 車クラス・6x4）。外観図より
#   全長 11,765 / 全幅 2,490 / 全高 3,660 / トレッド F 2,050・R 1,875
#   寸法の連なり 7,050（前軸→第2後軸）+ 1,350（後タンデム）+ 3,315（第2後軸→後端）
#   ★旋回中心の前後位置はカタログに無い。外観図の側面図で旋回台の柱の中心を測り、
#     第2後軸より 1,220mm 後ろと置いた（BT-400_params.md §7-1）
# =====================================================================
FRONT_AXLE = 8270.0
REAR_AXLE1 = 2570.0
REAR_AXLE2 = 1220.0
FRONT_END = 9670.0
REAR_END = -2095.0
WIDTH = 2490.0
TREAD_F, TREAD_R = 2050.0, 1875.0
FRAME_Z = 1000.0            # シャシフレームの上面
DUAL = 340.0                # 後輪のダブルタイヤの振り分け

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


def cargo_parts():
    """ユニック（icon_kenki/cargo.dwg）から 運転席 と 車輪 を借りる。

    ★BT-200 と同じ借り方。向こうは 3.5t 車なので、
      25t 車の全幅 2,490 に合わせて**等倍で**拡げる
      （長さだけ伸ばすと運転席が間延びする）。
    """
    if not os.path.isfile(CARGO):
        return None
    v, t = read_dump(CARGO)
    cl = clusters(v, t)
    cab_i, cab_v = cl[0]                              # いちばん大きい＝運転席＋シャシ
    wheels = [c for c in cl if len(c[0]) == 308]
    if not wheels:
        return None
    p = v[cab_v]
    x0, x1 = p[:, 0].min(), p[:, 0].max()             # ユニックは +x が後ろ
    yc = (p[:, 1].min() + p[:, 1].max()) / 2
    z0 = min(v[w[1]][:, 2].min() for w in wheels)     # ★地面＝車輪のいちばん下
    k = WIDTH / (p[:, 1].max() - p[:, 1].min())       # 全幅で合わせる（等倍）

    def conv(q):
        # ユニックの +x（前→後）→ BT-400 の -y、ユニックの +y → BT-400 の +x
        return np.c_[(q[:, 1] - yc) * k,
                     FRONT_END - (q[:, 0] - x0) * k,
                     (q[:, 2] - z0) * k]
    idx = {int(a): i for i, a in enumerate(cab_v)}
    cab = (conv(v[cab_v]), np.vectorize(idx.get)(t[cab_i]))

    wi, wv = wheels[0]
    q = v[wv]
    c = (q.min(axis=0) + q.max(axis=0)) / 2
    rad = (q[:, 2].max() - q[:, 2].min()) / 2
    kw = 525.0 / rad                                  # 25t 車のタイヤ半径 ≒ 525
    idx = {int(a): i for i, a in enumerate(wv)}
    wheel = (np.c_[(q[:, 1] - c[1]) * kw, -(q[:, 0] - c[0]) * kw, (q[:, 2] - c[2]) * kw + 525.0],
             np.vectorize(idx.get)(t[wi]))
    return cab, wheel, FRONT_END - (x1 - x0) * k


def make_body():
    p = []
    cab_back = 2200.0
    got = cargo_parts()
    if got:
        cab, wheel, cab_back = got
        p.append(cab)
        for ax, tr, dual in ((FRONT_AXLE, TREAD_F, False),
                             (REAR_AXLE1, TREAD_R, True),
                             (REAR_AXLE2, TREAD_R, True)):
            for sx in (-1, 1):
                offs = (-DUAL / 2, DUAL / 2) if dual else (0.0,)
                for o in offs:
                    v, t = wheel
                    p.append((v + np.array([sx * tr / 2 + sx * o, ax, 0.0]), t))
    else:
        p.append(box(-WIDTH / 2, REAR_END, 500, WIDTH / 2, FRONT_END, FRAME_Z))
        p.append(box(-WIDTH / 2 + 80, FRONT_AXLE - 900, FRAME_Z,
                     WIDTH / 2 - 80, FRONT_END, FRAME_Z + 1800))
    # --- シャシフレーム（借りた運転席の後ろから車体後端まで）---
    for sy in (-1, 1):
        p.append(box(sy * 440 - 60, REAR_END, FRAME_Z - 300,
                     sy * 440 + 60, min(cab_back + 400, FRONT_AXLE), FRAME_Z))
    # --- 架装部（外観図を見ながら箱で。ポンプ・タンク・工具箱・作業床）---
    p.append(box(-WIDTH / 2, REAR_END, FRAME_Z, WIDTH / 2, cab_back, FRAME_Z + 180))  # 床板
    p.append(box(-WIDTH / 2, REAR_END + 300, FRAME_Z + 180,
                 -WIDTH / 2 + 520, REAR_END + 2200, FRAME_Z + 1100))                  # 左の箱
    p.append(box(WIDTH / 2 - 520, REAR_END + 300, FRAME_Z + 180,
                 WIDTH / 2, REAR_END + 2200, FRAME_Z + 1100))                         # 右の箱
    p.append(box(-760, REAR_AXLE2 - 200, FRAME_Z + 180, 760, cab_back, FRAME_Z + 760))  # 油圧ユニット
    # ブームを寝かせて載せる受け（格納時の枕）
    p.append(box(-300, cab_back - 500, FRAME_Z + 760, 300, cab_back, FRAME_Z + 1900))
    return merge(p)


# =====================================================================
# 旋回台。原点＝旋回中心・地面、+x＝第1ブームが出る向き
#   第1ブーム フートピンは (-634, 0, 3043)
# =====================================================================
def make_turret():
    p = [box(-700, -800, FRAME_Z + 180, 700, 800, FRAME_Z + 420)]      # ベアリング座
    # 柱。上へ少し細くする
    v, t = prism(FRAME_Z + 420, 3043.0, 1500.0, 1300.0, 1100.0, 980.0)
    p.append((np.c_[-v[:, 2], v[:, 1], v[:, 0]], t))                   # +x を上へ向け直す
    p.append(box(-1000, -520, 2500, -280, 520, 3320))                  # ブーム取付ブラケット
    p.append(box(-1000, -900, FRAME_Z + 420, -300, 900, 2500))         # 操作盤・機械室
    return merge(p)


# =====================================================================
# アウトリガ。原点＝車体側の付け根、+x が張り出す向き
#   姿勢計算が x 方向にだけ伸ばす（基準の長さ 1,500）
# =====================================================================
def make_outrigger():
    return merge([box(0, -170, -170, 1500, 170, 170)])


def make_outrigger_foot():
    """ジャッキと接地板。原点はビームの高さ（地上 700）"""
    return merge([box(-210, -210, -520, 210, 210, 200),                # ジャッキ筒
                  box(-300, -300, -700, 300, 300, -520)])              # 接地板


# =====================================================================
# 第1ブーム（2 段油圧伸縮）。原点＝フートピン、+x が伸びる向き
#   長さ 6.0m〜7.9m（ストローク 1.9m）
# =====================================================================
BOOM1_LEN = 6000.0
BOOM1_W = [(640.0, 580.0), (550.0, 490.0)]


def make_boom1(i):
    w0, h0 = BOOM1_W[i]
    w1, h1 = w0 * 0.92, h0 * 0.92
    nose = 300.0
    p = [prism(0.0, BOOM1_LEN - nose, w0, h0, w1, h1)]
    p.append(prism(BOOM1_LEN - nose, BOOM1_LEN, w1, h1, w1 * 0.8, h1 * 0.6, 0.0, -h1 * 0.08))
    if i == 0:
        p.append(box(-180.0, -w0 / 2 - 70, -h0 / 2, 220.0, w0 / 2 + 70, h0 / 2))   # 根元の耳
    return merge(p)


# =====================================================================
# 第2ブーム（長さ 6.96m 固定）。原点＝上端ピン、+x が下へ伸びる向き
#   ★上端に旋回ヘッド（285°）、下端に第3ブームの起伏ピン
# =====================================================================
BOOM2_LEN = 6953.0


def make_boom2():
    w = 560.0
    p = [prism(260.0, BOOM2_LEN - 320.0, w, w, w * 0.95, w * 0.95)]
    p.append(box(-120.0, -480, -480, 260.0, 480, 480))                  # 旋回ヘッド
    p.append(box(BOOM2_LEN - 320.0, -440, -440, BOOM2_LEN, 440, 440))   # 下端の関節
    return merge(p)


# =====================================================================
# 第3ブーム（3 段同時伸縮）。原点＝第2ブーム下端、+x が伸びる向き
#   長さ 5.18m〜11.61m（ストローク 6.43m）
# =====================================================================
BOOM3_LEN = 5180.0
BOOM3_W = [520.0, 450.0, 380.0]


def make_boom3(i):
    w = BOOM3_W[i]
    p = [prism(0.0, BOOM3_LEN, w, w * 0.96, w * 0.92, w * 0.88)]
    if i == 0:
        p.append(box(-150.0, -w / 2 - 60, -w / 2, 150.0, w / 2 + 60, w / 2))
    return merge(p)


# =====================================================================
# 第4ブーム（長さ 1.3m・平行リンク構造）。原点＝第3ブーム先端、+x が伸びる向き
# =====================================================================
BOOM4_LEN = 1300.0


def make_boom4():
    p = [prism(0.0, BOOM4_LEN, 360.0, 330.0, 320.0, 300.0)]
    p.append(box(-130.0, -260, -230, 130.0, 260, 230))                  # 根元のピン座
    # 平行リンク（上側のロッド）
    p.append(box(60.0, -60, 200, BOOM4_LEN - 60, 60, 290))
    return merge(p)


# =====================================================================
# バスケット 2.0m × 0.85m、手すり 1.0m。アルミ合金製
#   原点＝床の【手前の端】・床の高さ。+x がバスケットの長手（差し込む向き）
#   ★第4ブーム先端ピンは、この原点の 1,720mm 真上にある。
#     自動水平なのでバスケットは傾かない。支柱もこの部品に入れて鉛直に保つ
# =====================================================================
BASKET_L, BASKET_W, BASKET_H = 2000.0, 850.0, 1000.0
BOOM4TIP_TO_FLOOR = 1720.0


def make_basket():
    r = 55.0
    p = [box(0, -BASKET_W / 2, -120, BASKET_L, BASKET_W / 2, 0)]        # 床
    for y in (-BASKET_W / 2, BASKET_W / 2 - r):                         # 長手の手すり
        p.append(box(0, y, BASKET_H - r, BASKET_L, y + r, BASKET_H))
        p.append(box(0, y, BASKET_H / 2 - r / 2, BASKET_L, y + r, BASKET_H / 2 + r / 2))
    for x in (0.0, BASKET_L - r):                                       # 短手の手すり
        p.append(box(x, -BASKET_W / 2, BASKET_H - r, x + r, BASKET_W / 2, BASKET_H))
        p.append(box(x, -BASKET_W / 2, BASKET_H / 2 - r / 2, x + r, BASKET_W / 2, BASKET_H / 2 + r / 2))
    for x in (0.0, BASKET_L / 2 - r / 2, BASKET_L - r):                 # 支柱
        for y in (-BASKET_W / 2, BASKET_W / 2 - r):
            p.append(box(x, y, 0, x + r, y + r, BASKET_H))
    # 第4ブーム先端までの支柱（★鉛直のまま。自動水平なのでここに入れる）
    p.append(box(-150, -150, 0, 150, 150, BOOM4TIP_TO_FLOOR))
    p.append(box(-220, -260, BOOM4TIP_TO_FLOOR - 220, 220, 260, BOOM4TIP_TO_FLOOR))
    return merge(p)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "models/TADANO_BT400"
    os.makedirs(out, exist_ok=True)
    parts = {"body": make_body(), "turret": make_turret(),
             "outrigger": make_outrigger(), "outrigger-foot": make_outrigger_foot(),
             "boom2": make_boom2(), "boom4": make_boom4(), "basket": make_basket()}
    for i in range(2):
        parts["boom1_%d" % i] = make_boom1(i)
    for i in range(3):
        parts["boom3_%d" % i] = make_boom3(i)

    index = {}
    for name, (v, t) in sorted(parts.items()):
        p = os.path.join(out, name + ".glb")
        write_glb(p, {BODY: (v, t)}, name=name)
        lo, hi = v.min(axis=0), v.max(axis=0)
        index[name] = {"file": name + ".glb", "tris": int(len(t)),
                       "min": [round(float(x), 2) for x in lo],
                       "max": [round(float(x), 2) for x in hi]}
        # ★自分で組んだ箱は、符号付き体積が正＝面が外向きであること
        vol = signed_volume(v - v.mean(axis=0), t)
        flag = "" if (name == "body" and os.path.isfile(CARGO)) or vol > 0 else "  ★面が裏返り"
        print("  %-12s 三角形 %5d  %7.0f x %7.0f x %7.0f mm%s"
              % (name, len(t), hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], flag))
    io.open(os.path.join(out, "_parts.json"), "w", encoding="utf-8",
            newline="\n").write(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    print("\n部品 %d / 三角形 %d" % (len(index), sum(x["tris"] for x in index.values())))


if __name__ == "__main__":
    main()
