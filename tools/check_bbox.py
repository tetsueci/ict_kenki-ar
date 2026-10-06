# -*- coding: utf-8 -*-
"""出した GLB の外接箱を、CAD で測ったブロックの外接箱と突き合わせる。

   python check_bbox.py <_parts.json> <blockbox.txt> [--prefix KATO_SR-250Rf2_H-]
"""
import io, json, sys

parts = json.load(io.open(sys.argv[1], encoding="utf-8"))
prefix = sys.argv[sys.argv.index("--prefix") + 1] if "--prefix" in sys.argv else ""
want = {}
for i, line in enumerate(io.open(sys.argv[2], encoding="utf-8")):
    f = line.rstrip("\n").split("\t")
    if i == 0 or len(f) < 10:
        continue
    nm = f[0][len(prefix):] if prefix and f[0].startswith(prefix) else f[0]
    want[nm] = [float(x) for x in f[1:7]]

print("%-18s %28s %28s" % ("部品", "出した外接箱 (dX dY dZ)", "CAD で測った値"))
bad = 0
for nm, w in sorted(want.items()):
    if nm not in parts:
        print("  %-16s  GLB に無い" % nm); bad += 1; continue
    g = parts[nm]
    d = [g["max"][i] - g["min"][i] for i in range(3)]
    e = [w[i + 3] - w[i] for i in range(3)]
    ok = all(abs(d[i] - e[i]) <= max(1.0, e[i] * 0.01) for i in range(3))
    if not ok:
        bad += 1
    print("  %-16s %s %8.0f %8.0f %8.0f   %8.0f %8.0f %8.0f"
          % (nm, "  " if ok else "NG", d[0], d[1], d[2], e[0], e[1], e[2]))
print("\n%d / %d  一致（1%% または 1mm 以内）" % (len(want) - bad, len(want)))
