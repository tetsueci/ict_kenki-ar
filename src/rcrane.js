// ラフタークレーンの姿勢計算。
// terra-maniyac.lsp の action_rcrane（L742-1323）を JavaScript へ写したもの。
//
// ★入れたのは「経路を使わない・ジブを出さない・吊荷なし」の場合だけ。
//   走行とジブはあとで足す（骨は置いてある）。
// ★戻すのは部品ごとの世界行列（mm）。ページ側は three.js へそのまま渡せる。

import { add, mul, sub, cross, transX, insertMatrix } from './ocs.js';

// ★insertMatrix が受けるのは「その法線の OCS の点」。
//   WCS へ直してから渡すと、法線が傾いている部品
//   （ブーム・シリンダ）が y と z を入れ替えたような場所へ飛ぶ。
//   車体まわりは法線が (0,0,1) なので、間違えても気づけない

const D2R = Math.PI / 180;
const EZ = [0, 0, 1];

/**
 * @param {object} m    機械の定義（machines/*.json）
 * @param {object} st   { outrigger(m), angleCabin(度), angleBoom(度),
 *                        lengthBoom(m), lengthWire(m) }
 * @param {object} base { point:[x,y,z] WCS mm, angle: ラジアン, normal:[x,y,z] }
 */
export function poseRoughTerrainCrane(m, st, base) {
  const d = m.dims;
  const scale = m.scale ?? 1;
  const normalBody = base.normal ?? EZ;
  const angleBody = base.angle ?? 0;
  const pBodyW = base.point;
  let pBody = transX(pBodyW, EZ, normalBody);     // 車体 OCS

  const parts = {};
  parts.body = insertMatrix(pBody, normalBody, angleBody);

  // --- アウトリガ -------------------------------------------------------
  //   ★縮めきったとき（bool_up）は足を height[0] だけ持ち上げ、
  //     接地板を隠す。もとのコードのとおり
  let lenOut = 0.5 * st.outrigger * 1000 * scale;
  const half = 0.5 * d.width_outrigger[0];
  if (lenOut - half < 0.05) lenOut = half;
  const boolUp = lenOut === half;

  const vxBody = [Math.cos(angleBody), Math.sin(angleBody), 0];
  const vyBody = [-vxBody[1], vxBody[0], 0];
  const SIDE = [-1, 1, -1, 1];
  const NAMES = [["outrigger_fr", "foot_fr", "plate_fr"],
                 ["outrigger_fl", "foot_fl", "plate_fl"],
                 ["outrigger_br", "foot_br", "plate_br"],
                 ["outrigger_bl", "foot_bl", "plate_bl"]];
  const hidden = [];
  d.body_to_outrigger.forEach((v, i) => {
    const pm = SIDE[i];
    const p = add(add(add(add(pBody, mul(vxBody, v[0])), mul(vyBody, v[1])),
                      mul(EZ, v[2])), mul(vyBody, pm * lenOut));
    const pUp = boolUp ? add(p, [0, 0, d.height_outrigger[0]]) : p;
    const ang = angleBody + pm * 0.5 * Math.PI;
    const [nOut, nFoot, nPlate] = NAMES[i];
    parts[nOut] = insertMatrix(p, normalBody, ang);
    parts[nFoot] = insertMatrix(pUp, normalBody, ang);
    parts[nPlate] = insertMatrix(p, normalBody, ang);
    if (boolUp) hidden.push(nPlate);
  });

  // --- 旋回体 -----------------------------------------------------------
  const angleCabin = st.angleCabin * D2R;
  const pCabin = add(pBody, d.body_to_cabin);
  const aN = angleBody + angleCabin - Math.PI / 2;
  const normalBoom = transX([Math.cos(aN), Math.sin(aN), 0], normalBody, EZ);
  const pCabinB = transX(pCabin, normalBody, normalBoom);
  const vxwBoom = cross(normalBody, normalBoom);
  let vx = transX(vxwBoom, EZ, normalBoom);
  const angleBoomParallel = Math.atan2(vx[1], vx[0]);
  let vy = [-vx[1], vx[0], 0];

  // ★3 本目の軸は ez ではなく vec_normal_boom。もとのコードがそうなっている
  //   （どちらも z 成分が 0 の寸法しか来ないので結果は変わらないが、写しは合わせる）
  const place = (p, o, v1, v2, v3) =>
    add(add(add(p, mul(v1, o[0])), mul(v2, o[1])), mul(v3, o[2]));

  const pBoomAxis = place(pCabinB, d.cabin_to_boom, vx, vy, normalBoom);
  const pCyl0 = place(pCabinB, d.cabin_to_cylinder, vx, vy, normalBoom);

  parts.cabin = insertMatrix(pCabin, normalBody, angleCabin + angleBody);

  // --- 起伏 -------------------------------------------------------------
  const angleBoom = st.angleBoom * D2R;
  const aBoomS = angleBoom + angleBoomParallel;
  vx = [Math.cos(aBoomS), Math.sin(aBoomS), 0];
  vy = [-vx[1], vx[0], 0];

  const pCyl1 = place(pBoomAxis, d.boom_to_cylinder, vx, vy, normalBoom);
  const angleCyl = Math.atan2(pCyl1[1] - pCyl0[1], pCyl1[0] - pCyl0[0]);
  parts.cylinder0 = insertMatrix(pCyl0, normalBoom, angleCyl);
  parts.cylinder1 = insertMatrix(pCyl1, normalBoom, angleCyl);

  // --- 伸縮 -------------------------------------------------------------
  //   boom0 は根元。boom1.. が伸びる段。段ごとに同じだけずらす
  const nSec = m.boomSections;                   // boom1..boomN の本数
  const lengthBoom = st.lengthBoom * 1000 * scale;
  const move = (lengthBoom - d.length_boom[0]) / nSec;
  const pBoomEnd = add(add(pBoomAxis, mul(vx, lengthBoom)), mul(vy, d.y_boom_end));

  parts.boom0 = insertMatrix(pBoomAxis, normalBoom, aBoomS);
  for (let i = 1; i <= nSec; i++) {
    // boom1 がいちばん奥（先端から (nSec-1) 段ぶん戻る）
    const p = sub(pBoomEnd, mul(vx, move * (nSec - i)));
    parts['boom' + i] = insertMatrix(p, normalBoom, aBoomS);
  }

  // --- ワイヤとフック ---------------------------------------------------
  let lengthWire = st.lengthWire;
  if (lengthWire < 0.2) lengthWire = 0.2;
  lengthWire = lengthWire * 1000 * scale;

  const pWireW = transX(pBoomEnd, normalBoom, EZ);
  const pHookW = sub(pWireW, [0, 0, lengthWire + d.hook]);
  const zScale = lengthWire / d.wire;
  // ★ワイヤとフックは法線を変えない（つねに真下へ垂れる）。回転は旋回角だけで、
  //   車体角を足していない。もとのコードがそうなっている
  parts.wire = insertMatrix(pWireW, EZ, angleCabin, [1, 1, zScale]);
  parts.hook = insertMatrix(pHookW, EZ, angleCabin);

  // --- 作業半径 ---------------------------------------------------------
  const pCircleW = transX([pCabin[0], pCabin[1], pBody[2]], normalBody, EZ);
  const radius = Math.hypot(pCircleW[0] - pWireW[0], pCircleW[1] - pWireW[1]);

  return { parts, hidden, radius, tip: pWireW, hook: pHookW, boomUp: boolUp };
}
