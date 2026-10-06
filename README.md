# 重機 AR

terra-maniyac と同じ動きを、スマホの画面の中で——**現実の地面に重機を置いて動かす**。

> **2026-10-06 に `DAM\kenki\ar\` から分けた**（ユーザー決定）。
> もとの CAD の道具（AutoLISP）は **`DAM\kenki\`** に残っている。ここは「スマホで見て動かす側」だけ。
>
> - 寸法と動きの出どころは `DAM\kenki\terra-maniyac.lsp`。
>   写すときに踏んだ不具合は `DAM\kenki\known_issues.md`
> - GLB 書き出しの共通部品の正は **`ict_ar-viewer/tools/glb.py`**。
>   写さずに隣のリポジトリから読む（あちらの README の決まり）
> - ACIS の中間ファイル（12MB）は入れていない。
>   `DAM\kenki\work\<機械>\acis\` にある（git の外）

```
ict_kenki-ar/
  index.html              ページ（3D 表示＋AR）
  package.json            type: module（src/ を Node でもブラウザでも同じものとして読む）
  src/ocs.js              AutoCAD の OCS（%library.lsp の vh-xyz / trans-x を写したもの）
  src/rcrane.js           ラフタークレーン（action_rcrane を写したもの）
  src/ccrane.js           クローラークレーン（action_ccrane を写したもの）
  machines/*.json         機械1台ぶんの数字（XDATA の中身に名前を付けたもの）
  models/<機械>/*.glb     部品ごとのメッシュ
  tools/                  DWG の 3DSOLID → GLB（CAD は要らない）
  test/run.mjs            クローラー   → node test/run.mjs
  test/run_rcrane.mjs     ラフター     → node test/run_rcrane.mjs
```

見るには

```bash
py -m http.server 8795 --bind 127.0.0.1 --directory .
```

（`DAM\.claude\launch.json` に `kenki-ar` として入れてある）

---

## 1. なぜ ict_ar-viewer の作りがそのまま使えるのか

`ict_ar-viewer/common/align.js` を読んだ結果、**土台はそのまま使える**と分かった。

- **three.js + WebXR（`immersive-ar` / `hit-test`）**で動いている。
  `<model-viewer>` の AR ボタンではない
- iPhone は **Variant Launch**（`common/vlaunch.js`）で WebXR を通している
- 点群・GLB・十字・2 点合わせ・縮尺のボタンが、すでに全部ある

★**ここが決め手。** Scene Viewer（Android）や Quick Look（iPhone）に GLB を渡す作りだと、
出せるのは**出来合いのアニメーションだけ**で、**関節を指で動かすことはできない**。
align.js は three.js のシーングラフを自分で持っているので、
**毎フレーム部品の行列を差し替えられる**——terra-maniyac がやっていることと同じ。

## 2. 要るものは3つ

| | 中身 | いまの状態 |
|---|---|---|
| **① 形** | 部品ごとのメッシュ（GLB） | KATO は**できた**。ほかの機種はまだ |
| **② 数字** | 寸法・関節・部品の並び（JSON） | **できた**（`machines/*.json`）|
| **③ 動き** | `action_*` を JavaScript に写したもの | ラフターとクローラーは**できた** |

②は「**形はブロック、数字はテキスト**」がそのまま効く。
XDATA の名前なしの数列に名前を付けただけのものが、**そのままアプリの入力**になる。

## 3. 形：3DSOLID（ACIS）から三角形へ

`KATO_SR250Rf2.dwg` の部品ブロックの中身は **3DSOLID（ACIS）**だった。
バックホウやクローラーのポリフェイスメッシュとは別物。

```bash
python tools/solids_to_glb.py \
       ../DAM/kenki/work/KATO_SR250Rf2/acis models/KATO_SR250Rf2 \
       --prefix "KATO_SR-250Rf2_H-"
python tools/check_bbox.py models/KATO_SR250Rf2/_parts.json \
       ../DAM/kenki/work/KATO_SR250Rf2/blockbox.txt --prefix "KATO_SR-250Rf2_H-"
```

| 道具 | 役目 |
|---|---|
| `tools/sat_decode.py` | `entget` の group 1/3 を **159−c** でほどく |
| `tools/satgraph.py` | face→loop→coedge→edge→curve をたどって**曲面**を三角形に |
| `tools/solids_to_glb.py` | 平面は ezdxf、曲面は satgraph。ブロックごとに GLB |
| `tools/check_bbox.py` | 出した外接箱を CAD の実測と突き合わせる |

ezdxf は**平らな面しか返さない**（本人の注記どおり。曲面を割るには ACIS のカーネルが要る）ので、
曲面は自前。KATO は 2039 面のうち平面 1508・円柱円錐 479・torus 24・spline 28。

**CAD で測ったブロックの外接箱と 10 / 12 一致**（三角形 8409）。
残り 2 つは曲面の取りこぼしで、**フックの喉の丸み（−148mm）**と、16 角形で内接させたぶん（−0.6%）。

### 踏んだもの（どれもコードのコメントに残した）

- ★ACIS の `transform` を掛け忘れるとブームが **9350mm 飛ぶ**
  （2026-09 にブロック定義を平行移動して直した、あのずれと同じ数）
- ★弧の媒介変数の範囲を使わないと、隅の丸みが 1 周の円になって**キャビンが 7 倍**に伸びる
- `tcoedge-coedge` / `tedge-edge` は並びが違う。読むと見当違いの円を拾う
- 「同じ軸の円を並べて筒にする」方式は、関係のない穴どうしが繋がる（没）

## 4. 動き：実機と突き合わせて確かめている

**「JS で動いた」ではなく「CAD と同じ数になった」**を確かめる。

```
node test/run_rcrane.mjs    3184 / 3184 一致   （ラフター）
node test/run.mjs            158 /  158 一致   （クローラー）
```

### ラフター（`src/rcrane.js` ← `action_rcrane` L742-1323）

アウトリガ・旋回・起伏・伸縮・ワイヤ・フック・起伏シリンダ。走行とジブと吊荷はまだ。

**16 姿勢 × 22 部品 = 352 件**の置き場所を、実機で測った値と 1 つずつ突き合わせている
（挿入点 x/y/z・回転・法線・Z 倍率・表示／非表示）。ずれは最大 **0.005mm**。

- ★**`insertMatrix` が受けるのは「その法線の OCS の点」。**
  WCS へ直してから渡すと、法線が傾いている部品（ブーム・シリンダ）が
  y と z を入れ替えたような場所へ飛ぶ。
  車体まわりは法線が (0,0,1) なので**間違えても気づけない**

### クローラー（`src/ccrane.js` ← `action_ccrane` L1324-1662）

ブーム 5 種 × 起伏 4 × 旋回 2 の 40 姿勢ほか。作業半径・先端 z・フック z が **0.05mm 以内**。
★`tip`/`gantry` の XY だけ 0.2〜0.3mm ずれるのは、車体の挿入点を
有効数字6桁でしか控えていないため（`test/ccrane_cases.json` の `baseNote`）。

### 写すときの決めごと

- ★**OCS をきちんと写す。** ブームの部品は「**鉛直な面**」を法線に持つ INSERT。
  `src/ocs.js` は AutoCAD の Arbitrary Axis Algorithm（1/64 のしきい値も）をそのまま入れた
- **近道は写さない。** もとの「前回と同じなら飛ばす」判定は実際には効いていない
  （`DAM\kenki\known_issues.md` 2-1）ので、毎回ぜんぶ計算する
- **フックの回転だけ車体角を足していない。** もとのコードがそうなっているので、そのまま

## 5. 次にやること

1. ほかの機種の部品メッシュ（クローラー・バックホウ・トレーラー）。
   ポリフェイスメッシュなので ACIS より簡単
2. ジブ・走行・吊荷
3. フックの喉（torus 面）を割る
4. align.js と同じ「2 点合わせ」を入れて、現場の座標に乗せる
5. 公開（GitHub Pages）。**まだ remote を付けていない**

## 6. スマホで見るには

| | |
|---|---|
| **この PC** | `http://localhost:8795`。3D だけ（PC に WebXR が無い）|
| **同じ Wi-Fi のスマホ** | `--bind 0.0.0.0` にして `http://<PCのIP>:8795`。**3D だけ** |
| **AR** | ★**HTTPS が要る。** `http://` では `navigator.xr` 自体が出てこない |

AR まで出すには GitHub Pages のような HTTPS の置き場所が要る。

- **Android（Chrome）** … Pages に上げればそのまま動く
- **iPhone（Safari）** … Safari に WebXR が無いので **Variant Launch** を通す。
  `index.html` の先頭で `ict_ar-viewer/common/vlaunch.js` を読んでいる（写していない）。
  ★module より**先に**、普通の `script` として読むこと（`document.write` で SDK を差し込むため）
