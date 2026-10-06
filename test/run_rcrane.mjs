// 写した action_rcrane が、実機で測った部品の置き場所と合うかを見る。
//   node test/run_rcrane.mjs
//
// ★16 姿勢 × 22 部品 = 352 件の「挿入点・回転・法線・倍率・表示」を
//   1 つずつ突き合わせる。CAD と同じ数になることが確かめたいこと。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { poseRoughTerrainCrane } from '../src/rcrane.js';
import { matrixOrigin, axes } from '../src/ocs.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = p => JSON.parse(readFileSync(join(here, p), 'utf8'));
const C = read('rcrane_cases.json');
const M = read(join('..', 'machines', C.machine + '.json'));

const TOLMM = 0.05;          // mm
const TOLRAD = 1e-6;
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
  const c0 = [mx[0], mx[1], mx[2]], c1 = [mx[4], mx[5], mx[6]], c2 = [mx[8], mx[9], mx[10]];
  const nz = [c2[0], c2[1], c2[2]];
  const ln = Math.hypot(...nz);
  const normal = ln > 1e-9 ? nz.map(v => v / ln) : [0, 0, 1];
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
  const [i, outrigger, angleCabin, angleBoom, lengthBoom, lengthWire, radius] = pose;
  const r = poseRoughTerrainCrane(
    M, { outrigger, angleCabin, angleBoom, lengthBoom, lengthWire }, C.base);
  // 測った値は knk_rcrane_apply が mm を丸めて m にしたもの
  chk('radius', `姿勢${i}`, Math.round(r.radius) / 1000, radius, 0.0011);

  for (const row of byPose.get(i) || []) {
    const [, part, x, y, z, rot, nx, ny, nz, sx, sy, sz, vis] = row;
    const mx = r.parts[part];
    if (!mx) { miss.add(part); continue; }
    const o = matrixOrigin(mx);
    const tag = `姿勢${i} ${part}`;
    chk('x', tag, o[0], x, TOLMM);
    chk('y', tag, o[1], y, TOLMM);
    chk('z', tag, o[2], z, TOLMM);
    const dc = decompose(mx);
    // 回転は 2π の差を許す
    let dr = dc.rot - rot;
    while (dr > Math.PI) dr -= 2 * Math.PI;
    while (dr < -Math.PI) dr += 2 * Math.PI;
    chk('rot', tag, dr, 0, 1e-5);
    // 測定値は小数 6 桁で書き出しているので、それ以上は比べられない
    chk('nx', tag, dc.normal[0], nx, 1e-6);
    chk('ny', tag, dc.normal[1], ny, 1e-6);
    chk('nz', tag, dc.normal[2], nz, 1e-6);
    chk('sz', tag, dc.sz, sz, 1e-6);
    const want = vis ? 1 : 0;
    const got = r.hidden.includes(part) ? 0 : 1;
    chk('vis', tag, got, want, 0.5);
  }
}

for (const k of Object.keys(worst).sort()) {
  console.log(`  ${k.padEnd(7)} 最大差 ${worst[k].toExponential(2)}`);
}
if (miss.size) console.log('  ★計算していない部品:', [...miss].join(' '));
console.log(`\n${n - bad} / ${n} 一致`);
process.exit(bad ? 1 : 0);
