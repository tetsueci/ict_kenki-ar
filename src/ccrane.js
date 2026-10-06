// クローラークレーンの姿勢計算。
// terra-maniyac.lsp の action_ccrane（L1324-1662）を JavaScript へ写したもの。
//
// ★入れたのは「経路を使わない」場合だけ。走行（road）はあとで足す。
// ★戻すのは部品ごとの世界行列（mm）。描く側は three.js へそのまま渡せる。
//
// 対応する LISP との差:
//   ・荷重表の引き当ては入れていない（AR では出さない）
//   ・吊荷と俯角は入れていない
//   ・str_*_pre による「前回と同じなら飛ばす」近道は入れていない（毎回ぜんぶ計算する。
//     もとのコードでもその近道は実際には効いていない。kenki/known_issues.md 2-1）

import { add, mul, sub, unit, cross, transX, toWorld, insertMatrix } from './ocs.js';

const D2R = Math.PI / 180;

/**
 * @param {object} m        機械の定義（machines/*.json）
 * @param {object} st       いまの値 { angleCabin, angleBoom, lengthWire, boomType } 角度は度、長さは m
 * @param {object} base     車体の置き方 { point:[x,y,z] (WCS mm), angle: ラジアン, normal:[x,y,z] }
 * @returns {{parts:Object<string,number[]>, radius:number, hook:number[], tip:number[]}}
 */
export function poseCrawlerCrane(m, st, base) {
  const d = m.dims;
  const normalBody = base.normal ?? [0, 0, 1];
  const angleBody = base.angle ?? 0;
  const pBodyW = base.point;                      // WCS
  const pBody = transX(pBodyW, [0, 0, 1], normalBody);   // 車体 OCS

  const angleCabin = st.angleCabin * D2R;
  const angleBoom = st.angleBoom * D2R;
  const boomType = Math.min(Math.max(st.boomType | 0, 0), m.booms.length - 1);
  const distBoom = m.booms[boomType].length;

  // --- 旋回体 ---------------------------------------------------------
  const pCabin = add(pBody, d.body_to_cabin);

  // ブームが乗る「鉛直な面」の法線。方位は (車体 + 旋回) から 90 度ずらしたもの
  const aN = angleBody + angleCabin - Math.PI / 2;
  const normalBoom = transX([Math.cos(aN), Math.sin(aN), 0], normalBody, [0, 0, 1]);

  const pCabinB = transX(pCabin, normalBody, normalBoom);   // ブーム OCS での旋回中心

  // ブーム OCS での「水平」方向。方位は 車体 + 旋回
  const vxw = cross(normalBody, normalBoom);
  let vx = transX(vxw, [0, 0, 1], normalBoom);
  const angleBoomParallel = Math.atan2(vx[1], vx[0]);
  let vy = [-vx[1], vx[0], 0];

  const place = (p, o) => add(add(add(p, mul(vx, o[0])), mul(vy, o[1])), [0, 0, o[2]]);
  const pBoom = place(pCabinB, d.cabin_to_boom);
  const pSpreader0 = place(pCabinB, d.cabin_to_spreader);

  // --- 起伏 -----------------------------------------------------------
  const aBoomS = angleBoom + angleBoomParallel;
  vx = [Math.cos(aBoomS), Math.sin(aBoomS), 0];
  vy = [-vx[1], vx[0], 0];

  const pWire = add(pBoom, mul(vx, distBoom));           // ブーム先端（ブーム OCS）
  const pSpreader2 = place(pWire, d.boom_to_spreader);

  const aSpreader = Math.atan2(pSpreader2[1] - pSpreader0[1], pSpreader2[0] - pSpreader0[0]);
  const vSpreader = unit(sub(pSpreader0, pSpreader2));
  const pSpreader1 = add(pSpreader2, mul(vSpreader, d.spreader1));
  const xScale = Math.hypot(
    pSpreader1[0] - pSpreader0[0], pSpreader1[1] - pSpreader0[1], pSpreader1[2] - pSpreader0[2],
  ) / d.spreader0;

  // --- ワイヤとフック（ここだけ WCS で計算する）------------------------
  const lengthWire = st.lengthWire * 1000 * (m.scale ?? 1);
  const pWireW = transX(pWire, normalBoom, [0, 0, 1]);
  const pHookW = sub(pWireW, [0, 0, lengthWire + d.hook]);
  const zScale = lengthWire / d.wire;

  // --- 作業半径 -------------------------------------------------------
  const pCircleW = transX([pCabin[0], pCabin[1], pBody[2]], normalBody, [0, 0, 1]);
  const radius = Math.hypot(pCircleW[0] - pWireW[0], pCircleW[1] - pWireW[1]);

  // --- 部品ごとの世界行列 ---------------------------------------------
  const parts = {};
  parts.body = insertMatrix(pBody, normalBody, angleBody);
  parts.cabin = insertMatrix(transX(pCabin, normalBody, normalBody), normalBody,
    angleCabin + angleBody);

  // ブームは選んだ 1 本だけ出す。残りは行列を入れない（＝隠す）
  parts['boom' + boomType] = insertMatrix(pBoom, normalBoom, aBoomS);

  parts.spreader0 = insertMatrix(pSpreader0, normalBoom, aSpreader);
  parts.spreader1 = insertMatrix(pSpreader1, normalBoom, aSpreader);
  // ガイロープは倍率で伸ばす（もとのコードは X 倍率だけ掛ける）
  parts.boom_wire = insertMatrix(pSpreader0, normalBoom, aSpreader, [xScale, 1, 1]);
  parts.boom_guyline = insertMatrix(pSpreader2, normalBoom, aSpreader);

  parts.wire = insertMatrix(pWireW, [0, 0, 1], angleCabin + angleBody, [1, 1, zScale]);
  // ★フックの回転だけ angle_body を足していない。もとのコードがそうなっている
  parts.hook = insertMatrix(pHookW, [0, 0, 1], angleCabin);

  return {
    parts,
    radius,
    tip: pWireW,
    hook: pHookW,
    visibleBoom: 'boom' + boomType,
    guyScale: xScale,
  };
}
