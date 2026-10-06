# -*- coding: utf-8 -*-
"""DWG の部品ブロック（3DSOLID の集まり）→ 部品ごとの GLB。

  CAD からは BRIDGE で ACIS の生文字列を書き出しておく（work/<機械>/acis/*.sat）。
  ここでは
    1. 159-c をほどく（sat_decode.load）
    2. ezdxf で ACIS を読み、面を三角形にする
    3. ブロックごとにまとめて GLB を 1 つ書く
  という順。CAD は要らない。

  ★座標は **ブロックのまま（mm・Z 上）** で書く。
    ページ側が「CAD → three.js」の変換をまとめて掛けるので、ここで直すと二重になる。
    GLB を単体で開くと横倒しで巨大に見えるが、それで正しい。

  ★ezdxf の coedge の読み方を 1 か所だけ直している（下の PATCH を見ること）。

  使い方:
    python solids_to_glb.py <acisフォルダ> <出力フォルダ> [--prefix KATO_SR-250Rf2_H-]
"""
import io, os, sys, glob, json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sat_decode import load as sat_load                      # noqa: E402
from satgraph import curved_faces                            # noqa: E402

# ★GLB 書き出しの共通部品の正は ict_ar-viewer/tools（あちらの README の決まり）。
#   写さずに、隣のリポジトリから読む。
#   置き場所が変わっても良いように、上へ轿って探す
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

from ezdxf.acis import sat as _sat                           # noqa: E402
from ezdxf.acis import api as acis                           # noqa: E402

# ---- PATCH ----------------------------------------------------------
# ★AutoCAD/ASM が DWG に書く SAT は、coedge の pcurve の手前に整数が 1 つ入る。
#   ezdxf は「SAT には無い」として読み飛ばす作りなので、
#   そのままだと pcurve の位置で「expected pointer, got str」で落ちる。
#   読み飛ばす代わりに、**本当に整数が置いてあるときだけ** 1 つ食べる。
_orig_read_int = _sat.SatDataLoader.read_int


def _read_int(self, skip_sat=None):
    if skip_sat is not None:
        tok = self.data[self.index] if self.index < len(self.data) else None
        if isinstance(tok, str):
            try:
                v = int(tok)
                self.index += 1
                return v
            except ValueError:
                pass
        return skip_sat
    return _orig_read_int(self, skip_sat)


_sat.SatDataLoader.read_int = _read_int
# ---- /PATCH ---------------------------------------------------------


def fan(poly):
    """多角形を三角形に割る（扇）。面は平らか、ほぼ平らなので扇で足りる"""
    return [(poly[0], poly[i], poly[i + 1]) for i in range(1, len(poly) - 1)]


def mesh_of(path):
    """1 つの .sat から (頂点 Nx3, 三角形 Mx3) を返す。

    平らな面は ezdxf、曲面（円柱・円錐）は tubes.py。
    ★ezdxf は平らな面しか返さないので、曲面を足さないと
      ワイヤ・起伏シリンダ・フックの軸がまるごと消える"""
    text = sat_load(path)
    verts, tris = [], []

    def push(v, t):
        base = len(verts)
        verts.extend([tuple(x) for x in v])
        tris.extend([(a + base, b + base, c + base) for a, b, c in t])

    err = None
    try:
        for b in acis.load(text):
            for m in acis.mesh_from_body(b):
                tt = []
                for f in m.faces:
                    if len(f) >= 3:
                        tt.extend(fan(list(f)))
                push(m.vertices, tt)
    except Exception as e:                       # 曲面だけの立体はここで落ちる
        err = e
    flat_box = None
    if verts:
        a = np.asarray(verts)
        flat_box = (a.min(axis=0), a.max(axis=0))
    tv, tt = curved_faces(text, flat_box=flat_box)
    if tv is not None:
        push(tv, tt)
    if not tris and err is not None:
        raise err
    return verts, tris


def main():
    src, out = sys.argv[1], sys.argv[2]
    prefix = ""
    if "--prefix" in sys.argv:
        prefix = sys.argv[sys.argv.index("--prefix") + 1]
    os.makedirs(out, exist_ok=True)

    blocks = {}
    bad = []
    for p in sorted(glob.glob(os.path.join(src, "*.sat"))):
        blk = os.path.basename(p).split("__")[0]
        try:
            v, t = mesh_of(p)
        except Exception as e:
            bad.append((os.path.basename(p), type(e).__name__ + ": " + str(e)[:70]))
            continue
        if not t:
            continue
        V, T = blocks.setdefault(blk, ([], []))
        base = len(V)
        V.extend(v)
        T.extend([(a + base, b + base, c + base) for a, b, c in t])

    index = {}
    for blk, (V, T) in sorted(blocks.items()):
        name = blk[len(prefix):] if prefix and blk.startswith(prefix) else blk
        arrv = np.asarray(V, dtype=np.float64)
        arrt = np.asarray(T, dtype=np.int64)
        path = os.path.join(out, name + ".glb")
        # 色は 1 つだけ。実物の色は後で足す
        write_glb(path, {(0.62, 0.66, 0.70, 1.0): (arrv, arrt)}, name=name)
        lo, hi = arrv.min(axis=0), arrv.max(axis=0)
        index[name] = {
            "file": name + ".glb",
            "tris": int(len(arrt)),
            "min": [round(float(x), 2) for x in lo],
            "max": [round(float(x), 2) for x in hi],
        }
        print("  %-24s 三角形 %6d  %8.0f x %8.0f x %8.0f mm"
              % (name, len(arrt), hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]))

    io.open(os.path.join(out, "_parts.json"), "w", encoding="utf-8", newline="\n").write(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    print("\n部品 %d / 三角形 %d" % (len(index), sum(v["tris"] for v in index.values())))
    if bad:
        print("\n★読めなかったもの %d" % len(bad))
        for f, e in bad[:10]:
            print("   ", f, e)


if __name__ == "__main__":
    main()
