// 写した計算が、実機で測った値と合うかを見る。
//   node test/run.mjs
//
// ★「JS で動いた」ではなく「CAD と同じ数になった」を確かめる。
//   数字は 2026-09-08 に crawler.dwg の実機から読み出したもの。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { poseCrawlerCrane } from '../src/ccrane.js';
import { matrixOrigin } from '../src/ocs.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = p => JSON.parse(readFileSync(join(here, p), 'utf8'));
const C = read('ccrane_cases.json');
const M = read(join('..', 'machines', C.machine + '.json'));

const TOL = 0.5;            // mm
let n = 0, bad = 0, worst = 0, worstName = '';
const group = {};

function check(name, got, want, tol = TOL) {
  n++;
  const d = Math.abs(got - want);
  const g = name.split(' ').pop();
  if (!(g in group) || d > group[g]) group[g] = d;
  if (d > worst) { worst = d; worstName = name; }
  if (d > tol) {
    bad++;
    if (bad <= 12) console.log(`  NG ${name}  got=${got.toFixed(3)} want=${want.toFixed(3)} d=${d.toFixed(3)}`);
  }
}

// ---- 1. ブーム5種 × 起伏4 × 旋回2 -----------------------------------
for (const [bt, ab, ac, radius, tipZ, hookZ] of C.sweep.rows) {
  const r = poseCrawlerCrane(M, {
    boomType: bt, angleBoom: ab, angleCabin: ac, lengthWire: C.sweep.lengthWire,
  }, C.base);
  const tag = `sweep b${bt} 起伏${ab} 旋回${ac}`;
  check(`${tag} radius`, r.radius, radius);
  check(`${tag} tipZ`, r.tip[2], tipZ);
  check(`${tag} hookZ`, r.hook[2], hookZ);
  // 選んだブームだけが出ていること
  if (r.visibleBoom !== 'boom' + bt) { bad++; console.log(`  NG ${tag} visibleBoom=${r.visibleBoom}`); }
  for (let i = 0; i < M.booms.length; i++) {
    if (i !== bt && r.parts['boom' + i]) { bad++; console.log(`  NG ${tag} boom${i} が出ている`); }
  }
}

// ---- 2. 旋回（先端とガントリの XY が追従するか）----------------------
for (const [ac, tx, ty, gx, gy, gz] of C.cabin.rows) {
  const r = poseCrawlerCrane(M, {
    boomType: C.cabin.boomType, angleBoom: C.cabin.angleBoom,
    angleCabin: ac, lengthWire: C.cabin.lengthWire,
  }, C.base);
  const g = matrixOrigin(r.parts.spreader1);
  const tag = `旋回${ac}`;
  check(`${tag} tipX`, r.tip[0], tx);
  check(`${tag} tipY`, r.tip[1], ty);
  check(`${tag} gantryX`, g[0], gx);
  check(`${tag} gantryY`, g[1], gy);
  check(`${tag} gantryZ`, g[2], gz);
  check(`${tag} guyScale`, r.guyScale, C.cabin.guyScale, 0.005);
}

// ---- 3. ワイヤ長さ ----------------------------------------------------
for (const [lw, drop, zscale] of C.wire.rows) {
  const r = poseCrawlerCrane(M, {
    boomType: C.wire.boomType, angleBoom: C.wire.angleBoom,
    angleCabin: C.wire.angleCabin, lengthWire: lw,
  }, C.base);
  check(`ワイヤ${lw}m drop`, r.tip[2] - r.hook[2], drop);
  check(`ワイヤ${lw}m zscale`, r.parts.wire[10], zscale, 0.005);
}

for (const k of Object.keys(group).sort()) {
  console.log(`  ${k.padEnd(9)} 最大差 ${group[k].toFixed(4)}`);
}
console.log(`\n${n - bad} / ${n} 一致  （いちばん大きい差 ${worst.toFixed(4)} mm : ${worstName}）`);
console.log('★tip/gantry の XY だけ 0.2-0.3mm ずれるのは、車体の挿入点を'
  + '有効数字6桁でしか控えていないため（baseNote）。半径と z は 0.05mm 以内');
process.exit(bad ? 1 : 0);
