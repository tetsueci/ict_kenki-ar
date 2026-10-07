// 写した action_backhoe が、CAD が置いた部品の場所と合うかを見る。
//   node test/run_backhoe.mjs
//
// ★正解は backhoe.dxf のモデル空間にそのまま入っていた 16 部品。
//   BRIDGE を立てずに、CAD が置いた挿入点・回転・法線と突き合わせられる。
//   ただし姿勢は 1 つだけ。別の姿勢は BRIDGE で動かして足すこと。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { poseBackhoe } from '../src/backhoe.js';
import { matrixOrigin, axes, toWorld } from '../src/ocs.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = p => JSON.parse(readFileSync(join(here, p), 'utf8'));
const C = read('backhoe_cases.json');
const M = read(join('..', 'machines', C.machine + '.json'));

const TOLMM = 0.001;         // mm（図面の値は小数 6 桁で持っている）
let n = 0, bad = 0;
const worst = {};
const miss = new Set();

function chk(kind, name, got, want, tol) {
  n++;
  const d = Math.abs(got - want);
  if (!(kind in worst) || d > worst[kind]) worst[kind] = d;
  if (d > tol) {
    bad++;
    if (bad <= 15) console.log(`  NG ${name} ${kind}  got=${got} want=${want} d=${d}`);
  }
}

// 行列から回転角と法線を取り出す（insertMatrix の逆）
function decompose(mx) {
  const c0 = [mx[0], mx[1], mx[2]], c2 = [mx[8], mx[9], mx[10]];
  const ln = Math.hypot(...c2);
  const normal = ln > 1e-9 ? c2.map(v => v / ln) : [0, 0, 1];
  const [ax, ay] = axes(normal);
  const sx = Math.hypot(...c0);
  const u = c0.map(v => v / (sx || 1));
  const rot = Math.atan2(u[0] * ay[0] + u[1] * ay[1] + u[2] * ay[2],
                         u[0] * ax[0] + u[1] * ax[1] + u[2] * ax[2]);
  return { normal, rot, sx, sz: ln };
}

const byPose = new Map();
for (const row of C.parts) {
  if (!byPose.has(row[0])) byPose.set(row[0], []);
  byPose.get(row[0]).push(row);
}

for (const pose of C.poses) {
  const [i, angleCabin, angleBoom, angleArm, angleBucket, bucketType] = pose;
  const r = poseBackhoe(M, { angleCabin, angleBoom, angleArm, angleBucket, bucketType },
                        C.base);

  for (const row of byPose.get(i) || []) {
    const [, part, x, y, z, rot, nx, ny, nz, , , sz, vis] = row;
    const tag = `姿勢${i} ${part}`;
    const mx = r.parts[part];
    // 表示するかどうかは、位置より先に見る
    chk('vis', tag, (mx && !r.hidden.includes(part)) ? 1 : 0, vis, 0.5);
    // ★隠す部品（選んでいないアタッチメント）は、図面の値が
    //   前に置かれたままの古い場所なので比べない
    if (!vis) continue;
    if (!mx) { miss.add(part); continue; }
    const o = matrixOrigin(mx);
    // ★DXF の 10 番は「その図形の OCS」の点。世界座標に直してから比べる。
    //   直さないと、法線が傾いている部品だけ y と z を入れ替えたように見える
    const w = toWorld([x, y, z], [nx, ny, nz]);
    chk('x', tag, o[0], w[0], TOLMM);
    chk('y', tag, o[1], w[1], TOLMM);
    chk('z', tag, o[2], w[2], TOLMM);
    const dc = decompose(mx);
    let dr = dc.rot - rot;
    while (dr > Math.PI) dr -= 2 * Math.PI;
    while (dr < -Math.PI) dr += 2 * Math.PI;
    chk('rot', tag, dr, 0, 1e-7);
    chk('nx', tag, dc.normal[0], nx, 1e-9);
    chk('ny', tag, dc.normal[1], ny, 1e-9);
    chk('nz', tag, dc.normal[2], nz, 1e-9);
    chk('sz', tag, dc.sz, sz, 1e-9);
  }
}

for (const k of Object.keys(worst).sort()) {
  console.log(`  ${k.padEnd(5)} 最大差 ${worst[k].toExponential(2)}`);
}
if (miss.size) console.log('  ★計算していない部品:', [...miss].join(' '));
console.log(`\n${n - bad} / ${n} 一致`);
process.exit(bad ? 1 : 0);
