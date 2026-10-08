// 搭乗したときの目の位置が、旋回しても機械に付いて回るかを見る。
//   node test/run_eye.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { poseBackhoe } from '../src/backhoe.js';
import { poseRoughTerrainCrane } from '../src/rcrane.js';
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

console.log(`\n${n - bad} / ${n} 一致`);
process.exit(bad ? 1 : 0);
