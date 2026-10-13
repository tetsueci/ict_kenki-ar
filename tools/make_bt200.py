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
_BOX_T = np.array([
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]], dtype=np.int64)


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


# ---------------------------------------------------------------------
# 車体（トラック 3.5t 車クラス）
#   ★旋回中心を原点にする。車両の長手は y、+x はブームが出る側（車両左）。
#     全長 5750 / 全幅 2180 / 全高 3690（格納時。キャブは約 2180）
#     ホイールベース 2795 / リヤオーバーハング 1845
#   ★旋回中心の車両方向の位置はカタログから決まらない。
#     後軸より前 300mm（荷台のほぼ中央）と置いた → BT-200_params.md §5
# ---------------------------------------------------------------------
def make_body():
    W = 1090.0                      # 全幅 2180 の半分
    p = []
    p.append(box(-W, -2500, 400, W, 3250, 900))            # シャシ
    p.append(box(-W + 60, 1250, 900, W - 60, 3250, 2180))  # キャブ
    p.append(box(-W, -2400, 900, W, 1150, 1600))           # 架装部（ポンプ・タンク）
    for sy in (2795 - 300, -300):                           # 前軸・後軸
        for sx in (-1, 1):
            tr = 1680.0 if sy > 0 else 1525.0
            p.append(box(sx * tr / 2 - 180, sy - 420, 0, sx * tr / 2 + 180, sy + 420, 840))
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
    p = [box(-420, -480, 1070, 420, 480, 1200),            # ベアリング座
         box(-350, -400, 1200, 350, 400, 2710),            # 柱
         box(-420, -480, 2560, 420, 480, 2860)]            # ブーム取付部
    return merge(p)


# ---------------------------------------------------------------------
# ブーム（2 段）。原点＝フートピン、+x が伸びる向き
#   長さ 3.06m〜5.11m（ストローク 2.05m）
# ---------------------------------------------------------------------
BOOM_LEN = 3060.0
BOOM_STROKE = 2050.0


def make_boom(i):
    w = 340.0 - i * 60.0
    return tube(BOOM_LEN, w, w)


# ---------------------------------------------------------------------
# ポスト（5 段）。原点＝各段の上端、+x は下向きに伸びる向き（鉛直）
#   全長 3.325m〜9.825m（ストローク 6.5m ＝ 1.625m × 4 段）
# ---------------------------------------------------------------------
POST_LEN = 3325.0
POST_STEP = 1625.0
POST_W = [650.0, 560.0, 470.0, 380.0, 300.0]


def make_post(i):
    w = POST_W[i]
    return tube(POST_LEN, w, w)


# ---------------------------------------------------------------------
# デッキブーム（3 段同時伸縮）。原点＝ポスト下端、+x が伸びる向き
#   長さ 3.5m〜8.21m（ストローク 4.71m ＝ 2.355m × 2 段）
# ---------------------------------------------------------------------
DBOOM_LEN = 3500.0
DBOOM_STEP = 2355.0


def make_deckboom(i):
    w = 420.0 - i * 60.0
    return tube(DBOOM_LEN, w, w)


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
