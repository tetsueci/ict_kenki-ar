# -*- coding: utf-8 -*-
"""CAD が吐いた STL → 部品ごとの GLB。

  ACIS を自前で三角形にすると面が落ちる（平面だけで 46% 取りこぼし）。
  CAD はカーネルを持っているので、CAD に割らせる。
  STL の作り方は DAM/kenki/work/<機械>/make_mesh.lsp（AutoCAD で KATOMESH）。

  ★★STLOUT は座標を 0 以上へずらす。
    cylinder0 で min が (-0.07, -134.74, -137) → STL では (0,0,0)。
    そのままだと部品がずれて組み上がらない。
    make_mesh.lsp が一緒に書き出す _bbox.txt（CAD で測った外接箱）と
    STL の外接箱を突き合わせて、元の場所へ戻す。

  ★窓ガラス: **--glass** に立体の名前（<部品>__<番号>）を並べると、
    その立体だけ別のプリミティブにして透かす。
    ★STL には色が入っていないので、**どの立体が窓かは形で決める**
    （DXF から作る dxf_to_glb.py は図面の色 255,255,255 で決められる）。

  使い方:
    python tools/stl_to_glb.py <meshフォルダ> <出力フォルダ> [--glass cabin__5 cabin__6]
"""
import io, os, sys, glob, json
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


def read_stl(path):
    """ASCII STL → (頂点 Nx3, 三角形 Mx3)。三角形ごとに頂点を分けたまま"""
    v = []
    with io.open(path, encoding="latin-1") as f:
        for line in f:
            line = line.lstrip()
            if line.startswith("vertex"):
                v.append([float(x) for x in line.split()[1:4]])
    if len(v) < 3:
        return None, None
    a = np.asarray(v, dtype=np.float64)
    n = (len(a) // 3) * 3
    a = a[:n]
    t = np.arange(n, dtype=np.int64).reshape(-1, 3)
    return a, t


def read_bbox(path):
    out = {}
    for line in io.open(path, encoding="latin-1"):
        f = line.rstrip("\n").split("\t")
        if len(f) < 7 or f[0].startswith("#"):
            continue
        out[f[0]] = (np.array([float(x) for x in f[1:4]]),
                     np.array([float(x) for x in f[4:7]]))
    return out


# 既定の色と、窓ガラスの色（dxf_to_glb.py と同じ）
BODY = (0.62, 0.66, 0.70, 1.0)
GLASS = (0.68, 0.80, 0.86, 0.30)


def main():
    src, out = sys.argv[1], sys.argv[2]
    glass = set()
    if "--glass" in sys.argv:
        for a in sys.argv[sys.argv.index("--glass") + 1:]:
            if a.startswith("--"):
                break
            glass.add(a)
    os.makedirs(out, exist_ok=True)
    bb = read_bbox(os.path.join(src, "_bbox.txt"))
    # ★立体 1 つにつき STL 1 本。部品名ごとに足し合わせる
    group = {}
    for p in sorted(glob.glob(os.path.join(src, "*.stl"))):
        stem = os.path.splitext(os.path.basename(p))[0]
        # ★立体ごとの "<部品>__<番号>.stl" だけを読む。
        #   部品まるごとの古い STL が残っていることがあり、
        #   そちらは 0 バイトのまま CAD が掴んでいて開けない
        if stem.startswith("_") or "__" not in stem:
            continue
        name = stem.split("__")[0]
        try:
            v, t = read_stl(p)
        except OSError as e:
            print("  %-18s 開けない（%s）" % (stem, type(e).__name__))
            continue
        if v is None:
            print("  %-18s 読めない" % stem)
            continue
        if stem in bb:
            # ★STL のずれを、CAD で測った外接箱で立体ごとに戻す
            v = v + (bb[stem][0] - v.min(axis=0))
        V, T, G = group.setdefault(name, ([], [], []))
        base = sum(len(x) for x in V)
        V.append(v)
        T.append(t + base)
        G.append(np.full(len(t), stem in glass, dtype=bool))

    index = {}
    for name, (Vs, Ts, Gs) in sorted(group.items()):
        v = np.concatenate(Vs)
        t = np.concatenate(Ts)
        g = np.concatenate(Gs)
        path = os.path.join(out, name + ".glb")
        groups = {BODY: (v, t[~g])}
        n_glass = int(g.sum())
        if n_glass:
            groups[GLASS] = (v, t[g])
        write_glb(path, groups, name=name)
        lo, hi = v.min(axis=0), v.max(axis=0)
        index[name] = {"file": name + ".glb", "tris": int(len(t)),
                       "min": [round(float(x), 2) for x in lo],
                       "max": [round(float(x), 2) for x in hi]}
        if n_glass:
            index[name]["glass"] = n_glass
        print("  %-18s 三角形 %6d  %8.0f x %8.0f x %8.0f mm  (立体 %d)%s"
              % (name, len(t), hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2], len(Vs),
                 "  うちガラス %d" % n_glass if n_glass else ""))
    io.open(os.path.join(out, "_parts.json"), "w", encoding="utf-8",
            newline="\n").write(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    print("\n部品 %d / 三角形 %d" % (len(index), sum(v["tris"] for v in index.values())))


if __name__ == "__main__":
    main()
