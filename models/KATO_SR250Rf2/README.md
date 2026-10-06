# KATO SR-250Rf2 の部品メッシュ

`KATO_SR250Rf2.dwg` の部品ブロック（中身は **3DSOLID＝ACIS**）から出した GLB。
**CAD に三角形化させている**（STL 経由）。

```bash
# 1) AutoCAD 側（BRIDGE の inbox から vla-SendCommand で流す）
#    (load ".../kenki/work/KATO_SR250Rf2/make_mesh.lsp") KATOMESH
# 2) こちら側
python tools/stl_to_glb.py ../DAM/kenki/work/KATO_SR250Rf2/mesh models/KATO_SR250Rf2
python tools/check_bbox.py models/KATO_SR250Rf2/_parts.json \
       ../DAM/kenki/work/KATO_SR250Rf2/blockbox.txt --prefix "KATO_SR-250Rf2_H-"
```

★座標は**ブロックのまま（mm・Z 上）**。ページ側が CAD → three.js の変換を
まとめて掛けるので、ここで直すと二重になる。

## 確かめたこと

CAD で測ったブロックの外接箱と **12 / 12 一致**（部品 18・三角形 24,314）。

## なぜ ACIS を自前で割るのをやめたか

最初は `ezdxf` で ACIS を読んで三角形にしていたが、**穴だらけ**になった。
数えた結果:

| | 枚 |
|---|---|
| ACIS の面（全体）| 2039 |
| うち平面 | 1508 |
| ezdxf が返した平面 | 809 |
| → **取りこぼした平面** | **699（46%）** |

`ezdxf` の `mesh_from_body` は「**縁が直線だけでできた平らな面**」しか返さない
（本人の注記どおり。曲面を割るには ACIS のカーネルが要る）。
丸みのある縁・穴のある面・曲面は全部落ちる。キャビンは 80% 欠けていた。

## CAD 側で分かったこと（AutoCAD 2026 で実測）

- **COM（vla）に三角形化は無い。** 3DSOLID に `Explode` / `ConvertToMesh` /
  `Tessellate` / `GetMesh` はどれも無い（`vlax-invoke` でも「不正な名前」）。
  あるのは `Boolean` / `CheckInterference` / `SectionSolid` / `SliceSolid` /
  `GetBoundingBox` / `TransformBy` / `Copy` / `IntersectWith` / `Mirror3D`
- **`MESHSMOOTH` はコマンドとしては在る**（`CMDNAMES` に出る）が、
  選択を渡しても**変換しない**（後も 3DSOLID のまま）
- **`3DPRINT` は無い**
- ★**`STLOUT` は通る。** カーネルが割った三角形がそのまま出る

## STLOUT の癖（踏んだもの）

- ★★**座標を 0 以上へずらすことがある。** cylinder0 で min が
  (-0.07, -134.74, -137) → STL では (0,0,0)。ずらさない部品もある。
  `make_mesh.lsp` が **CAD で測った外接箱**を `_bbox.txt` に一緒に書き出し、
  `stl_to_glb.py` がそれで戻す
- ★**立体 1 つにつき STL 1 本にする。** 部品の立体をまとめて渡すと、
  1 つこけただけで**部品ごと 0 バイト**になり、しかも AutoCAD が
  そのファイルを掴んだままになって消せなくなった（キャビンで発生）
- `FILEDIA` を 0 にしないとファイル名を聞いてくれない
