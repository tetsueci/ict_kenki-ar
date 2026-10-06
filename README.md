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

## 3. 形：CAD に三角形化させる（STL 経由）

部品ブロックの中身は機種で違う。

| 機種 | 中身 | 作り方 |
|---|---|---|
| KATO SR-250Rf2 | **3DSOLID（ACIS）** | CAD に STL を吐かせる → `tools/stl_to_glb.py` |
| バックホウ・クローラー | ポリフェイスメッシュ | 面をそのまま読む（これから） |

```bash
# 1) AutoCAD 側（BRIDGE の inbox から vla-SendCommand で流す）
#    (load ".../kenki/work/KATO_SR250Rf2/make_mesh.lsp") KATOMESH
# 2) こちら側
python tools/stl_to_glb.py ../DAM/kenki/work/KATO_SR250Rf2/mesh models/KATO_SR250Rf2
python tools/check_bbox.py models/KATO_SR250Rf2/_parts.json        ../DAM/kenki/work/KATO_SR250Rf2/blockbox.txt --prefix "KATO_SR-250Rf2_H-"
```

CAD で測った外接箱と **12 / 12 一致**（部品 18・三角形 24,314）。

★**ACIS を自前で三角形にするのはやめた。** `ezdxf` で読むと
**平面だけで 46% 取りこぼし**、穴だらけになった（キャビンは 80% 欠け）。
ACIS を割るにはカーネルが要る。CAD は持っているので CAD にやらせる。
詳しくは `models/KATO_SR250Rf2/README.md`。

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

## 4b. 定格荷重と許容荷重（2026-10-07）

`定格荷重表ラフタークレーン.xlsm` を読んで、**定格荷重**と**許容荷重**を
作業半径といっしょに出す。★**表は機械ごとに違う**ので機械 1 台につき 1 つ。

```bash
python tools/xlsm_to_load.py "…/kenki/定格荷重表ラフタークレーン.xlsm"        machines/KATO_SR250Rf2.load.json
node test/run_load.mjs      # 379 / 379 一致
```

- 表の読み取りは `read_load_kenki`（terra-maniyac.lsp L7724 付近）と同じ並び。
  Excel の 620 マスと**全部一致**を確かめている
- 引き方は `action_rcrane`（L1222-1246）と同じ。
  アウトリガは「その段以上になる最初の段」、半径とブームは「その値以下になる
  最初の行・列」、空欄（不可）なら長いブームの段へずらす
- ★**単位はそろえた。** もとのコードは半径を mm、ブームを m に直してから
  どちらも mm の値と比べており、**ブームはどの列にも当たらない**
  （9350 <= 9.35 は成り立たない）。ここは表と同じメートルで通す
- ★**動かせる幅は表に合わせる。** アウトリガが 6.6m まである表なのに
  スライダーが 5.5m 止まりだと、いちばん張った段を選べない

## 4c. 操作盤（2026-10-07）

- ★**スライダーは 1 本だけ。** 何を動かすかはドロップダウンで選ぶ。
  項目ごとに並べるとスマホの画面が操作盤で埋まる
- **許容荷重割合**もその 1 本で動かす
- ★**縮尺は □/□ の数字入力。** 候補をボタンで並べると欲しい値が無いことがある。
  効くのは AR のときだけ（3D で縮めると機械が画面から消える）

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

### AR が始まらないとき

★**画面の下に理由が出る**（`AR を始められませんでした：…（https xr=あり Android）`）。
「押しても何も起きない」のは**こちらが知らせを出していなかった**ため（2026-10-06 に直した）。

★**頼むものを段々と減らして 3 回試す**（操作盤つき → 操作盤なし → 地面検出なし）。
どれかで始まればそれで進むし、全部断られたら**どれがなぜ断られたかを全部出す**。

- `xr=なし` … その端末・ブラウザに WebXR が無い。
  Android は **Chrome** と **「Google Play 開発者サービス（AR）」**（ARCore）が要る
- `http` … HTTPS でないと `navigator.xr` 自体が出てこない
- ★`requestReferenceSpace … does not support the requested reference space type`
  … **three.js の既定が `local-floor`** で、対応していない端末がある。
  `renderer.xr.setReferenceSpaceType('local')` で直る（2026-10-06 に実機で発生）。
  align.js も `'local'` にしている
- iPhone … ボタンが「iPhone：「開く」を押してください」に変わる。
  押すと Variant Launch の中で開き直してから AR になる

### ★カメラ映像までぼけるとき

**dom-overlay の親は AR 中に UA が全画面にする**。
その要素に `backdrop-filter` を付けると、**画面ごとぼける**
（カメラ映像もモデルも）。2026-10-06 に `blur(6px)` で実際に踏んだ。

- 親（`#ui`）は**透明で `pointer-events: none`**にする。align.js の `#overlay` と同じ
- 背景や影は中の箱（`#panel`）に付ける
- 透かすことで、操作盤の外をタップすれば地面に置ける

### AR に入ったらできること

- **地面を映して、十字が出たらタップ**すると、そこに置く
- ★**操作盤は AR の中でも出たまま**（`dom-overlay`）。置いたあとも
  旋回・起伏・伸縮を動かせる。操作盤を触っても置き直されない（`beforexrselect`）
- **縮尺**は 実寸 / 1/10 / 1/25 / 1/50 / 1/100
- ★**置く距離**は 足元 / 5m / 10m / 20m / 50m。
  地面の検出は足元までしか出ないことが多く、そこに置くと
  **離れないと動きが見えない**。見ている向きへ指定した距離だけ出して、
  見つかった床の高さに落とす
- 縮尺と距離は組。既定は **1/10 × 10m**（25t ラフターが 1.8m ほど）。
  狭いところなら 1/50 × 足元、外なら 実寸 × 20m
- ★置いたあとも十字は出たままで、**タップのたびに置き直せる**


- **Android（Chrome）** … Pages に上げればそのまま動く
- **iPhone（Safari）** … Safari に WebXR が無いので **Variant Launch** を通す。
  `index.html` の先頭で `ict_ar-viewer/common/vlaunch.js` を読んでいる（写していない）。
  ★module より**先に**、普通の `script` として読むこと（`document.write` で SDK を差し込むため）
