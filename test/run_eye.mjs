// 搭乗したときの目の位置が、旋回しても機械に付いて回るかを見る。
//   node test/run_eye.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { poseBackhoe } from '../src/backhoe.js';
import { poseRoughTerrainCrane } from '../src/rcrane.js';
import { poseBridgeChecker4 } from '../src/bchecker4.js';
import { eyeWorld } from '../src/eye.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = p => JSON.parse(readFileSync(join(here, '..', p), 'utf8'));
const BASE = { point: [0, 0, 0], angle: 0, normal: [0, 0, 1] };

let n = 0, bad = 0;
const chk = (name, got, want, tol = 1e-6) => {
  n++;
  const d = Math.abs(got - want);
  if (d > tol) { bad++; console.log(`  NG ${name}  got=${got} want=${want} d=${d}`); }
};
const chk3 = (name, got, want, tol) =>
  ['x', 'y', 'z'].forEach((k, i) => chk(`${name}.${k}`, got[i], want[i], tol));
const ok = (name, cond) => { n++; if (!cond) { bad++; console.log(`  NG ${name}`); } };

// --- バックホウ --------------------------------------------------------
{
  const M = read('machines/backhoe08.json');
  const st = { angleCabin: 0, angleBoom: 30, angleArm: -100, angleBucket: 30, bucketType: 0 };
  const e0 = eyeWorld(M, poseBackhoe(M, st, BASE));
  // 旋回 0°：cabin は body の上へ平行移動するだけ
  chk3('バックホウ 旋回0 位置', e0.point,
       [M.eye.point[0], M.eye.point[1], M.eye.point[2] + M.dims.body_to_cabin[2]], 1e-6);
  chk3('バックホウ 旋回0 前', e0.forward, [1, 0, 0], 1e-9);
  chk3('バックホウ 旋回0 上', e0.up, [0, 0, 1], 1e-9);

  // 旋回 90°：水平に 90° 回る。高さは変わらない
  const e9 = eyeWorld(M, poseBackhoe(M, { ...st, angleCabin: 90 }, BASE));
  chk3('バックホウ 旋回90 位置', e9.point,
       [-M.eye.point[1], M.eye.point[0], e0.point[2]], 1e-6);
  chk3('バックホウ 旋回90 前', e9.forward, [0, 1, 0], 1e-9);
  chk('バックホウ 旋回で高さが変わらない', e9.point[2], e0.point[2], 1e-9);
  // 旋回中心からの距離は変わらない
  const d0 = Math.hypot(e0.point[0], e0.point[1]);
  const d9 = Math.hypot(e9.point[0], e9.point[1]);
  chk('バックホウ 旋回中心からの距離', d9, d0, 1e-9);
}

// --- ラフタークレーン --------------------------------------------------
{
  const M = read('machines/KATO_SR250Rf2.json');
  const st = { outrigger: 6.6, angleCabin: 0, angleBoom: 45, lengthBoom: 20,
               lengthWire: 8, ratioAllow: 80 };
  const e0 = eyeWorld(M, poseRoughTerrainCrane(M, st, BASE));
  chk3('25tRC 旋回0 位置', e0.point,
       [M.eye.point[0], M.eye.point[1], M.eye.point[2] + M.dims.body_to_cabin[2]], 1e-6);
  chk3('25tRC 旋回0 前', e0.forward, [1, 0, 0], 1e-9);

  const e9 = eyeWorld(M, poseRoughTerrainCrane(M, { ...st, angleCabin: -90 }, BASE));
  chk3('25tRC 旋回-90 位置', e9.point,
       [M.eye.point[1], -M.eye.point[0], e0.point[2]], 1e-6);
  chk3('25tRC 旋回-90 前', e9.forward, [0, -1, 0], 1e-9);
  // ★起伏・伸縮では目の位置は動かない（上部旋回体に付いている）
  const e2 = eyeWorld(M, poseRoughTerrainCrane(M, { ...st, angleBoom: 70, lengthBoom: 35 }, BASE));
  chk3('25tRC 起伏・伸縮では動かない', e2.point, e0.point, 1e-9);
}

// --- BT-400（★運転席ではなくバスケットの中）--------------------------
{
  const M = read('machines/TADANO_BT400.json');
  const st = { outrigger: 2, angleSwing: 90, angleBoom1: 5, lengthBoom1: 6.88,
               angleBoom2: 0, angleSwivel: 0, angleBoom3: 0, lengthBoom3: 8.61,
               angleBoom4: -23, angleBasket: 0 };
  const P = o => {
    const r = poseBridgeChecker4(M, { ...st, ...o }, BASE);
    return { r, e: eyeWorld(M, r) };
  };

  // 目はバスケットの床の使える所に立っている（ブロック座標での確かめ）
  const p = M.eye.point;
  ok('BT400 目はバスケットの部品に付いている', M.eye.part === 'basket');
  ok('BT400 目は床の上（長手 0〜2000 の中・支柱をよけている）', p[0] > 150 && p[0] < 2000);
  ok('BT400 目は床の幅の中（±425）', Math.abs(p[1]) < 425);
  ok('BT400 目は手すり（1000）より上', p[2] > 1000);

  // ★自動水平装置。どの姿勢でも傾かず、床からの高さも変わらない
  for (const o of [{}, { angleBoom3: -70 }, { angleBoom3: 90 }, { angleBoom2: 45 },
                   { angleBoom2: 90 }, { angleBoom4: 90 }, { angleBasket: -90 },
                   { angleSwing: -100 }, { angleSwivel: 142.5 }]) {
    const q = P(o);
    chk3(`BT400 バスケットは水平 ${JSON.stringify(o)}`, q.e.up, [0, 0, 1], 1e-12);
    chk(`BT400 床からの目の高さ ${JSON.stringify(o)}`,
        q.e.point[2] - q.r.tip[2], M.eye.point[2], 1e-6);
  }

  // ★ほかの機械と違い、目は腕の動きについて回る（上部旋回体に固定ではない）
  const a0 = P({});
  const a1 = P({ angleBoom3: -70 });
  ok('BT400 第3ブームを下げると目も下がる', a1.e.point[2] < a0.e.point[2] - 5000);
  const a2 = P({ lengthBoom3: 11.61 });
  ok('BT400 第3ブームを伸ばすと目も動く',
     Math.hypot(a2.e.point[0] - a0.e.point[0], a2.e.point[1] - a0.e.point[1]) > 2900);

  // 首振りは視線を回す（立っている所もバスケットと一緒に回る）
  const b0 = P({ angleBasket: 0 }).e;
  const b9 = P({ angleBasket: -90 }).e;
  const ang = v => Math.atan2(v[1], v[0]) * 180 / Math.PI;
  let d = ang(b9.forward) - ang(b0.forward);
  while (d <= -180) d += 360;
  while (d > 180) d -= 360;
  chk('BT400 首振り -90 度で視線も -90 度', d, -90, 1e-9);
  chk('BT400 首振りしても目の高さは同じ', b9.point[2], b0.point[2], 1e-9);

  // 既定の姿勢は橋の下。目は地面より下にある
  ok('BT400 既定の姿勢で目は地下', a0.e.point[2] < 0);
}

console.log(`\n${n - bad} / ${n} 一致`);
process.exit(bad ? 1 : 0);
