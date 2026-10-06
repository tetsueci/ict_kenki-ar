# -*- coding: utf-8 -*-
"""DWG の 3DSOLID に入っている ACIS の文字列をほどく。

  CAD の entget が返す group 1 / 3 の文字列は **1 文字ずつ 159 から引いた**形。
  空白はそのまま。記憶 ijcad-solid-edges-via-acis の「159-c」。

  使い方:
    python sat_decode.py <acisフォルダ>            … 記録の種類を数える
    python sat_decode.py <acisフォルダ> --write    … ほどいた .sat を _sat/ へ書く
"""
import io, os, re, sys
from collections import Counter


def unscramble(s):
    return "".join(c if c == " " else chr(159 - ord(c)) if 0 <= 159 - ord(c) < 256 else c
                   for c in s)


def load(path):
    raw = io.open(path, encoding="latin-1").read().split("\n")
    return "\n".join(unscramble(l.rstrip("\r")) for l in raw)


def records(text):
    """ACIS SAT の 1 記録（# で終わる）に切る。先頭 3 行はヘッダ"""
    body = text.split("\n", 3)
    head, rest = body[:3], (body[3] if len(body) > 3 else "")
    out = []
    for r in rest.split("#"):
        r = r.strip()
        if r:
            out.append(r)
    return head, out


def kind(rec):
    """記録の種類（先頭の -<n> を外した最初の語）"""
    m = re.match(r"-?\d+\s+(\S+)", rec)
    return m.group(1) if m else rec.split()[0] if rec.split() else "?"


def main():
    folder = sys.argv[1]
    write = "--write" in sys.argv
    outdir = os.path.join(folder, "_sat")
    if write:
        os.makedirs(outdir, exist_ok=True)
    kinds = Counter()
    per_block = {}
    nfile = 0
    for fn in sorted(os.listdir(folder)):
        if not fn.endswith(".sat"):
            continue
        nfile += 1
        text = load(os.path.join(folder, fn))
        if write:
            io.open(os.path.join(outdir, fn), "w", encoding="latin-1",
                    newline="\n").write(text)
        head, recs = records(text)
        if nfile == 1:
            print("ヘッダ:", " | ".join(h.strip()[:70] for h in head))
        blk = fn.split("__")[0]
        c = per_block.setdefault(blk, Counter())
        for r in recs:
            k = kind(r)
            kinds[k] += 1
            c[k] += 1
    print("\nファイル %d / 記録 %d" % (nfile, sum(kinds.values())))
    print("\n--- 記録の種類（多い順）---")
    for k, n in kinds.most_common():
        print("  %-26s %6d" % (k, n))
    surf = [k for k in kinds if k.endswith("-surface")]
    curv = [k for k in kinds if "curve" in k]
    print("\n面の種類:", ", ".join("%s=%d" % (k, kinds[k]) for k in surf) or "なし")
    print("辺の種類:", ", ".join("%s=%d" % (k, kinds[k]) for k in curv) or "（直線のみ）")
    if write:
        print("\nほどいたものを書いた:", outdir)


if __name__ == "__main__":
    main()
