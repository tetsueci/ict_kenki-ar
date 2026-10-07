// バックホウ（油圧ショベル）の姿勢計算。
// terra-maniyac.lsp の action_backhoe（L1664-1960）を JavaScript へ写したもの。
//
// ★入れたのは「経路を使わない・吊荷なし」の場合だけ。走行はあとで足す。
// ★戻すのは部品ごとの世界行列（mm）。ページ側は three.js へそのまま渡せる。
//
// ★insertMatrix が受けるのは「その法線の OCS の点」。WCS へ直してから渡すと、
//   法線が傾いている部品（ブーム・アーム・バケット）が飛ぶ。rcrane.js と同じ。

import { add, mul, sub, cross, transX, insertMatrix } from './ocs.js';

const D2R = Math.PI / 180;
const EZ = [0, 0, 1];

// 寸法ベクトル o を軸 (v1,v2,v3) で足す
const place = (p, o, v1, v2, v3) =>
  add(add(add(p, mul(v1, o[0])), mul(v2, o[1])), mul(v3, o[2]));

// ★3 本目の軸は (0,0,1)。action_backhoe がそう書いてある
//   （action_rcrane は vec_normal_boom。来る寸法の z が 0 なので結果は変わらない）

/**
 * @param {object} m    機械の定義（machines/*.json）
 * @param {object} st   { angleCabin, angleBoom, angleArm, angleBucket（度）,
 *                        bucketType（0 から） }
 * @param {object} base { point:[x,y,z] WCS mm, angle: ラジアン, normal:[x,y,z] }
 */
export function poseBackhoe(m, st, base) {
  const d = m.dims;
  const normalBody = base.normal ?? EZ;
  const angleBody = base.angle ?? 0;
  const pBody = transX(base.point, EZ, normalBody);     // 車体 OCS

  const parts = {}, hidden = [];
  parts.body = insertMatrix(pBody, normalBody, angleBody);

  // --- 旋回体 -----------------------------------------------------------
  const angleCabin = st.angleCabin * D2R;
  const pCabin = add(pBody, d.body_to_cabin);
  const aN = angleBody + angleCabin - Math.PI / 2;
  const normalBoom = transX([Math.cos(aN), Math.sin(aN), 0], normalBody, EZ);
  const pCabinB = transX(pCabin, normalBody, normalBoom);
  let vx = transX(cross(normalBody, normalBoom), EZ, normalBoom);
  const angleBoomParallel = Math.atan2(vx[1], vx[0]);
  let vy = [-vx[1], vx[0], 0];

  const pBoom = place(pCabinB, d.cabin_to_boom, vx, vy, EZ);
  const pBoomCyl0 = place(pCabinB, d.cabin_to_cylinder, vx, vy, EZ);
  parts.cabin = insertMatrix(pCabin, normalBody, angleCabin + angleBody);

  // --- ブーム -----------------------------------------------------------
  // ★もとのコードはブームの回転に angle_boom（素の角度）を入れている。
  //   ピンの位置は angle_boom_s（＋angle_boom_parallel）で出しているので、
  //   車体が傾いた土地ではブームの絵だけ parallel ぶん回り足りない。
  //   ここは angle_boom_s にした。車体が水平なら parallel は 0 で同じ値になる
  //   （→ known_issues.md）
  const angleBoomS = st.angleBoom * D2R + angleBoomParallel;
  vx = [Math.cos(angleBoomS), Math.sin(angleBoomS), 0];
  vy = [-vx[1], vx[0], 0];

  const pBoomCyl1 = place(pBoom, d.boom_to_bcylinder, vx, vy, EZ);
  const pArmCyl0 = place(pBoom, d.boom_to_acylinder, vx, vy, EZ);
  const pArm = place(pBoom, d.boom_to_arm, vx, vy, EZ);
  const angleBoomCyl = Math.atan2(pBoomCyl1[1] - pBoomCyl0[1],
                                  pBoomCyl1[0] - pBoomCyl0[0]);
  parts.boom = insertMatrix(pBoom, normalBoom, angleBoomS);
  parts.boom_cylinder0 = insertMatrix(pBoomCyl0, normalBoom, angleBoomCyl);
  parts.boom_cylinder1 = insertMatrix(pBoomCyl1, normalBoom, angleBoomCyl);

  // --- アーム -----------------------------------------------------------
  const angleArmS = st.angleArm * D2R + angleBoomS;
  vx = [Math.cos(angleArmS), Math.sin(angleArmS), 0];
  vy = [-vx[1], vx[0], 0];

  const pArmCyl1 = place(pArm, d.arm_to_bocylinder, vx, vy, EZ);
  const pBucketCyl0 = place(pArm, d.arm_to_bucylinder, vx, vy, EZ);
  const pArmPin = place(pArm, d.arm_to_armpin, vx, vy, EZ);
  const pBucket = place(pArm, d.arm_to_bucket, vx, vy, EZ);
  const angleArmCyl = Math.atan2(pArmCyl1[1] - pArmCyl0[1],
                                 pArmCyl1[0] - pArmCyl0[0]);
  parts.arm = insertMatrix(pArm, normalBoom, angleArmS);
  parts.arm_cylinder0 = insertMatrix(pArmCyl0, normalBoom, angleArmCyl);
  parts.arm_cylinder1 = insertMatrix(pArmCyl1, normalBoom, angleArmCyl);

  // --- バケット（4 節リンク）--------------------------------------------
  //   バケットシリンダの先は、アームのピン（p_armpin）とバケットのリンク
  //   （p_bucketlink）から等距離に 2 つある交点の、上側。
  //   ★付け替えるアタッチメントごとに、バケットピンからリンクまでの
  //     長さ（dist）が違う
  const bi = Math.max(0, Math.min(m.buckets.length - 1, st.bucketType | 0));
  const bucket = m.buckets[bi];
  const angleBucketS = st.angleBucket * D2R + angleArmS;
  vx = [Math.cos(angleBucketS), Math.sin(angleBucketS), 0];
  vy = [-vx[1], vx[0], 0];

  const pLink = add(pBucket, mul(vx, bucket.dist));
  const dd = Math.hypot(pLink[0] - pArmPin[0], pLink[1] - pArmPin[1],
                        pLink[2] - pArmPin[2]);
  const vxL = mul(sub(pLink, pArmPin), 1 / dd);
  const vyL = [-vxL[1], vxL[0], 0];
  const ax = (d.bucketlink ** 2 - d.bucketpin ** 2 + dd * dd) / (2 * dd);
  const ay = Math.sqrt(Math.max(d.bucketpin ** 2 - ax * ax, 0));
  const pBucketCyl1 = place(pArmPin, [ax, ay, 0], vxL, vyL, EZ);

  const angleBucketCyl = Math.atan2(pBucketCyl1[1] - pBucketCyl0[1],
                                    pBucketCyl1[0] - pBucketCyl0[0]);
  const angleArmPin = Math.atan2(pBucketCyl1[1] - pArmPin[1],
                                 pBucketCyl1[0] - pArmPin[0]);
  const angleLink = Math.atan2(pBucketCyl1[1] - pLink[1],
                               pBucketCyl1[0] - pLink[0]);

  m.buckets.forEach((b, i) => { if (i !== bi) hidden.push('bucket' + i); });
  parts['bucket' + bi] = insertMatrix(pBucket, normalBoom, angleBucketS);
  parts.bucket_cylinder0 = insertMatrix(pBucketCyl0, normalBoom, angleBucketCyl);
  parts.bucket_cylinder1 = insertMatrix(pBucketCyl1, normalBoom, angleBucketCyl);
  parts.bucketlink_arm = insertMatrix(pArmPin, normalBoom, angleArmPin);
  parts.bucketlink_bucket = insertMatrix(pLink, normalBoom, angleLink);

  // --- 画面に出す値 -----------------------------------------------------
  //   ★刃先はバケットのブロックの中で、取付ピンから xy 面でいちばん遠い点。
  //     dxf_to_glb.py が far として書き出している（XDATA には入っていない）
  const far = bucket.far || [0, 0];
  const pTooth = place(pBucket, [far[0], far[1], 0], vx, vy, EZ);
  const pToothW = transX(pTooth, normalBoom, EZ);
  const pCenterW = transX([pCabin[0], pCabin[1], pBody[2]], normalBody, EZ);
  const radius = Math.hypot(pCenterW[0] - pToothW[0], pCenterW[1] - pToothW[1]);

  return {
    parts, hidden, radius, tip: pToothW,
    readouts: [
      `作業半径 ${(radius / 1000).toFixed(2)}m`,
      `刃先高さ ${(pToothW[2] / 1000).toFixed(2)}m`,
    ],
  };
}
