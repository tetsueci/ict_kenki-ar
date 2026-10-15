# -*- coding: utf-8 -*-
"""機械 1 台を、CAD（BRIDGE 経由）へ置ける形のデータに落とす。

  ★出すのは「機械の座標（原点＝旋回中心・地面、+y＝車両の前）」のまま。
    世界のどこへ置くかは CAD 側の INSERT で決める。
    こうしておくと、あとで姿勢を変えるときに**ブロックの中身だけ作り直せば**
    INSERT（置いた場所）はそのまま残る。

  書き出す形（ASCII・1 行 1 レコード）:
      l <画層名>            この後のメッシュが載る画層
      m <頂点数> <面数>      ポリフェイスメッシュの始まり
      v <x> <y> <z>         頂点（mm）
      f <a> <b> <c>         面（そのメッシュの中の 1 始まりの番号）

  ★LISP に巨大な 1 式を load させない（6 時間戻らなかったことがある）。
    LISP 側は read-line でこのファイルを舐めるだけにする。

  使い方:
    python tools/to_cad.py TADANO_BT400 out.dat
    python tools/to_cad.py TADANO_BT400 out.dat --state '{"angleBoom1":30}'
"""
import argparse
import importlib.util
import io
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

# 機械ごとの「部品を作る道具」と「部品名 → 画層」の決め方
MAKERS = {"TADANO_BT400": "make_bt400.py", "TADANO_BT200": "make_bt200.py"}

# 1 つのメッシュを 4 つに複製する部品（アウトリガ）。姿勢計算の名前の付け方に合わせる
COPIES = {"outrigger": "outrigger", "outrigger-foot": "foot"}


def load_maker(name):
    spec = importlib.util.spec_from_file_location("mk", os.path.join(HERE, name))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def build_parts(mk, machine):
    """部品名 → (頂点, 三角形)"""
    p = {}
    if machine == "TADANO_BT400":
        p = {"body": mk.make_body(), "turret": mk.make_turret(),
             "outrigger": mk.make_outrigger(), "outrigger-foot": mk.make_outrigger_foot(),
             "boom2": mk.make_boom2(), "boom4": mk.make_boom4(), "basket": mk.make_basket()}
        for i in range(2):
            p["boom1_%d" % i] = mk.make_boom1(i)
        for i in range(3):
            p["boom3_%d" % i] = mk.make_boom3(i)
    else:
        raise SystemExit("この機械の部品の作り方はまだ書いていない: " + machine)
    return p


def layer_of(prefix, part):
    """部品名 → 画層名。★段ごとに分けず、まとまりで分ける（画層が増えすぎる）"""
    base = part.split("_")[0]
    if base == "foot":
        base = "outrigger"
    return (prefix + "_" + base).upper()


def weld(v, t, tol=2):
    """同じ場所の頂点をまとめる。箱の寄せ集めなので頂点がかなり減る"""
    key = np.round(v, tol)
    uq, inv = np.unique(key, axis=0, return_inverse=True)
    tt = inv[t]
    keep = (tt[:, 0] != tt[:, 1]) & (tt[:, 1] != tt[:, 2]) & (tt[:, 2] != tt[:, 0])
    return uq, tt[keep]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("machine")
    ap.add_argument("out")
    ap.add_argument("--state", default="{}", help="操作の値の JSON。省くと既定の姿勢")
    ap.add_argument("--prefix", default=None, help="画層の接頭辞。既定は機械の short")
    a = ap.parse_args()

    if a.machine not in MAKERS:
        raise SystemExit("知らない機械: " + a.machine)

    # --- 姿勢（部品ごとの行列）は JS の姿勢計算から取る。Python へ写さない ---
    r = subprocess.run([("node.exe" if os.name == "nt" else "node"),
                        os.path.join(HERE, "pose.mjs"), a.machine, a.state],
                       capture_output=True, cwd=os.path.dirname(HERE))
    if r.returncode:
        sys.stderr.write(r.stderr.decode("utf-8", "replace"))
        raise SystemExit("pose.mjs が失敗した")
    pose = json.loads(r.stdout.decode("utf-8"))

    mj = json.load(io.open(os.path.join(HERE, "..", "machines", a.machine + ".json"),
                           encoding="utf-8"))
    prefix = a.prefix or mj.get("short") or a.machine
    parts = build_parts(load_maker(MAKERS[a.machine]), a.machine)
    hidden = set(pose.get("hidden") or [])

    nv_all = nf_all = 0
    rows, cur_layer = [], None
    for key, m in sorted(pose["parts"].items()):
        if key in hidden:
            continue
        name = key
        if name not in parts:                       # outrigger_fl → outrigger
            for b, pre in COPIES.items():
                if key.startswith(pre + "_"):
                    name = b
                    break
        if name not in parts:
            continue
        v, t = parts[name]
        M = np.array(m, dtype=float).reshape(4, 4).T        # JS は列優先
        w = (M @ np.c_[v, np.ones(len(v))].T).T[:, :3]
        w, t = weld(w, t)
        lay = layer_of(prefix, key)
        if lay != cur_layer:
            rows.append("l %s" % lay)
            cur_layer = lay
        rows.append("m %d %d" % (len(w), len(t)))
        rows.extend("v %.2f %.2f %.2f" % tuple(q) for q in w)
        rows.extend("f %d %d %d" % (x + 1, y + 1, z + 1) for x, y, z in t)
        nv_all += len(w)
        nf_all += len(t)
        print("  %-16s %-18s 頂点 %5d  面 %5d" % (key, lay, len(w), len(t)))

    io.open(a.out, "w", encoding="ascii", newline="\n").write("\n".join(rows) + "\n")
    print("\n%s  部品 %d / 頂点 %d / 面 %d  (%.1f KB)"
          % (a.out, len(pose["parts"]), nv_all, nf_all, os.path.getsize(a.out) / 1024.0))
    print("姿勢: " + " / ".join(pose.get("readouts") or []))
    io.open(a.out + ".state.json", "w", encoding="utf-8", newline="\n").write(
        json.dumps({"machine": a.machine, "state": pose["state"],
                    "readouts": pose["readouts"]}, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
