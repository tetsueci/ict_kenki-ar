# KATO SR-250Rf2 の部品メッシュ

`KATO_SR250Rf2.dwg` の部品ブロック（中身は **3DSOLID＝ACIS**）から出した GLB。
作り方は `tools/` の 3 本。CAD は要らない（ACIS の文字列は BRIDGE で
`../DAM/kenki/work/KATO_SR250Rf2/acis/` へ書き出し済み）。

```bash
python tools/solids_to_glb.py \
       ../DAM/kenki/work/KATO_SR250Rf2/acis models/KATO_SR250Rf2 \
       --prefix "KATO_SR-250Rf2_H-"
python tools/check_bbox.py \
       models/KATO_SR250Rf2/_parts.json \
       ../DAM/kenki/work/KATO_SR250Rf2/blockbox.txt --prefix "KATO_SR-250Rf2_H-"
```

★**座標はブロックのまま（mm・Z 上）**。ページ側が CAD → three.js の変換を
まとめて掛けるので、ここで直すと二重になる。GLB を単体で開くと横倒しで
巨大に見えるが、それで正しい。

## 確かめたこと

CAD で測ったブロックの外接箱（`blockbox.txt`）と突き合わせて **10 / 12 一致**。

残り 2 つは、どちらも**曲面を取りこぼしたぶん**:

| 部品 | 出した高さ | CAD | |
|---|---|---|---|
| hook | 975 | 1123 | フックの喉の丸み（torus）が無い。-148mm |
| jibhook | 667 | 671 | 16 角形で内接させているぶん。-0.6% |

機械全体で 2039 面のうち torus 24 面・spline 28 面（2.5%）を捨てている。
平面 1508 面と円柱・円錐 479 面は入っている。
