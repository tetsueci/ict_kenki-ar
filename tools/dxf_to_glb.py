# -*- coding: utf-8 -*-
"""DXF の部品ブロック → 部品ごとの GLB。

  ★バックホウ・クローラークレーン・トレーラーの部品は
    **ポリフェイスメッシュ（POLYLINE+VERTEX）と 3DFACE** で描いてある。
    ACIS（3DSOLID）ではないので、CAD に三角形化させる回り道（STLOUT）は要らない。
    DXF をそのまま読めば、CAD が持っている面がそっくり出る。
    → ラフタークレーン（KATO）だけが 3DSOLID で、あちらは stl_to_glb.py。

  読むもの:
    POLYLINE(70 の 64 ビット) + VERTEX
        70=192 … 座標の頂点
        70=128 … 面（71〜74 が 1 始まりの添字。負は「辺を描かない」印なので abs）
    3DFACE  … 10/20/30・11/21/31・12/22/32・13/23/33（13 が 12 と同じなら三角形）

  ★座標はブロックの基点を引いた値にする（DXF の 0 番グループ BLOCK の 10）。
    基点が部品ごとに違うと、組み上げたときに部品がその差だけ飛ぶ。

  ★出す GLB は CAD のまま（ミリ・Z 上向き・部品の座標系）。
    向きと縮尺はアプリ側（src/*.js と index.html）が持つ。stl_to_glb.py と同じ。

  ★色は 1 色（部品ごとの色はアプリ側が決める）。ただし **--glass** で
    真色（420 番）を指定すると、その色の面だけ別のプリミティブにして
    透けるようにする。バックホウのキャビンの窓は 255,255,255（=16777215）。

  使い方:
    python tools/dxf_to_glb.py <図面.dxf> <部品名の接頭辞> <出力フォルダ> [--glass 16777215]
  例:
    python tools/dxf_to_glb.py ../DAM/kenki/backhoe.dxf 汎用バックホウ0.8m3級            models/backhoe08 --glass 16777215
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


def pairs(path):
    """DXF を (グループコード, 値) の組で返す。★UTF-8。$DWGCODEPAGE は当てにしない"""
    f = io.open(path, "r", encoding="utf-8", errors="replace", newline="")
    while True:
        a = f.readline()
        if not a:
            f.close()
            return
        b = f.readline()
        if not b:
            f.close()
            return
        yield a.strip(), b.rstrip("\r\n")


# 既定の色（部品ごとの色づけはアプリ側）
BODY = (0.62, 0.66, 0.70, 1.0)
# ★窓ガラス。うっすら青みを付けて、透けていることが分かるようにする
GLASS = (0.68, 0.80, 0.86, 0.30)


def read_blocks(path, keep):
    """keep(ブロック名) が真のブロックだけ、(頂点, 三角形, 基点, 三角形ごとの色) で返す

    色は DXF の 420 番（真色）。無ければ None（＝部品の既定の色）。
    ★ポリフェイスメッシュの色は POLYLINE が持っていて、VERTEX は持っていない。
      VERTEX の 62/420 を見ても何も出ないので、POLYLINE の色を覚えておいて配る
    """
    out = {}
    blk = None          # いま読んでいるブロック名（keep が偽なら None）
    base = None
    ent = None
    g = {}              # いま読んでいる図形のグループ
    # ポリフェイスメッシュの作りかけ
    pf_v, pf_f, in_pf = [], [], False
    pf_col = [None]     # そのメッシュの色（POLYLINE が持っている）
    verts, tris, cols = [], [], []

    def flush_entity():
        """1 図形ぶんのグループが溜まったところで形にする"""
        nonlocal in_pf
        if blk is None:
            return
        if ent == "POLYLINE":
            # 70 の 64 ビットが立っていればポリフェイスメッシュ
            in_pf = (int(float(g.get("70", 0))) & 64) != 0
            del pf_v[:]
            del pf_f[:]
            pf_col[0] = int(float(g["420"])) if "420" in g else None
        elif ent == "VERTEX" and in_pf:
            fl = int(float(g.get("70", 0)))
            if fl & 128 and not (fl & 64):
                # 面の記録。71〜74 は 1 始まり。負は「辺を描かない」印
                idx = [abs(int(float(g[k]))) for k in ("71", "72", "73", "74")
                       if k in g and int(float(g[k])) != 0]
                if len(idx) >= 3:
                    pf_f.append(idx)
            else:
                pf_v.append([float(g.get("10", 0)), float(g.get("20", 0)),
                             float(g.get("30", 0))])
        elif ent == "SEQEND" and in_pf:
            base_i = len(verts)
            verts.extend(pf_v)
            for idx in pf_f:
                # 四角は 2 つの三角に割る
                for a, b, c in ([(0, 1, 2)] if len(idx) == 3
                                else [(0, 1, 2), (0, 2, 3)]):
                    tris.append([base_i + idx[a] - 1, base_i + idx[b] - 1,
                                 base_i + idx[c] - 1])
                    cols.append(pf_col[0])
            in_pf = False
        elif ent == "3DFACE":
            p = [[float(g.get(x, 0)), float(g.get(y, 0)), float(g.get(z, 0))]
                 for x, y, z in (("10", "20", "30"), ("11", "21", "31"),
                                 ("12", "22", "32"), ("13", "23", "33"))]
            b0 = len(verts)
            col = int(float(g["420"])) if "420" in g else None
            if p[3] == p[2]:        # 4 点目が 3 点目と同じ＝三角形
                verts.extend(p[:3])
                tris.append([b0, b0 + 1, b0 + 2])
                cols.append(col)
            else:
                verts.extend(p)
                tris.append([b0, b0 + 1, b0 + 2])
                tris.append([b0, b0 + 2, b0 + 3])
                cols.extend([col, col])

    pending_name = False
    for code, val in pairs(path):
        if code == "0":
            flush_entity()
            g = {}
            if val == "BLOCK":
                ent = "BLOCK"
                pending_name = True
                blk = None
                base = [0.0, 0.0, 0.0]
                verts, tris, cols = [], [], []
            elif val == "ENDBLK":
                if blk is not None:
                    out[blk] = (np.asarray(verts, dtype=np.float64),
                                np.asarray(tris, dtype=np.int64), base, list(cols))
                blk = None
                ent = None
            else:
                ent = val
            continue
        if ent == "BLOCK":
            if code == "2" and pending_name:
                pending_name = False
                blk = val if keep(val) else None
            elif code in ("10", "20", "30") and blk is not None:
                base[int(code) // 10 - 1] = float(val)
            continue
        g[code] = val
    return out


def main():
    src, prefix, out = sys.argv[1], sys.argv[2], sys.argv[3]
    glass = set()
    if "--glass" in sys.argv:
        for a in sys.argv[sys.argv.index("--glass") + 1:]:
            if a.startswith("--"):
                break
            glass.add(int(a, 16) if a.lower().startswith("0x") else int(a))
    os.makedirs(out, exist_ok=True)
    n = len(prefix)
    blocks = read_blocks(src, lambda s: s.startswith(prefix) and not s.startswith("set_"))
    if not blocks:
        raise SystemExit("接頭辞 %s のブロックが無い" % prefix)

    index = {}
    for name, (v, t, base, cols) in sorted(blocks.items()):
        short = name[n:] or name
        if len(v) == 0 or len(t) == 0:
            print("  %-20s 面が無い" % short)
            continue
        v = v - np.asarray(base)          # ★基点を原点に
        p = os.path.join(out, short + ".glb")
        # ★--glass に挙げた色の面だけ、透けるプリミティブに分ける
        isg = np.array([c in glass for c in cols], dtype=bool) if glass             else np.zeros(len(t), dtype=bool)
        groups = {BODY: (v, t[~isg])}
        n_glass = int(isg.sum())
        if n_glass:
            groups[GLASS] = (v, t[isg])
        write_glb(p, groups, name=short)
        lo, hi = v.min(axis=0), v.max(axis=0)
        # ★基点からいちばん遠い頂点。バケットなら「刃先」、ブームなら「先端」。
        #   XDATA には入っていないが、画面に出す値（作業半径・刃先の高さ）に要る
        #   ★距離はブロックの xy 面で測る（動きが面の中で起きるため）。
        #     3 次元で測るとバケットの横の角（z=±530）を拾って刃先にならない
        far = v[int(np.argmax((v[:, :2] ** 2).sum(axis=1)))]
        index[short] = {"file": short + ".glb", "tris": int(len(t)),
                        "min": [round(float(x), 2) for x in lo],
                        "max": [round(float(x), 2) for x in hi],
                        "far": [round(float(x), 2) for x in far]}
        if n_glass:
            index[short]["glass"] = n_glass
        print("  %-20s 三角形 %6d  %8.0f x %8.0f x %8.0f mm  基点 %s%s"
              % (short, len(t), hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2],
                 "0" if base == [0.0, 0.0, 0.0] else base,
                 "  うちガラス %d" % n_glass if n_glass else ""))
    io.open(os.path.join(out, "_parts.json"), "w", encoding="utf-8",
            newline="\n").write(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    print("\n部品 %d / 三角形 %d" % (len(index), sum(x["tris"] for x in index.values())))


if __name__ == "__main__":
    main()
