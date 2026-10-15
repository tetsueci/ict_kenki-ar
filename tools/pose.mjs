// 機械 1 台ぶんの「部品ごとの行列」を JSON で吐く。CAD へ置くときに使う。
//
//   node tools/pose.mjs TADANO_BT400 > pose.json
//   node tools/pose.mjs TADANO_BT400 '{"angleBoom1":30}' > pose.json
//
// ★基準は「機械の原点（旋回中心・地面）・回転 0」。
//   世界のどこに置くかは CAD 側の INSERT で決める。ここでは触らない。
// ★操作の値を省くと index.html と同じ既定の姿勢になる。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { poseBridgeChecker4 } from '../src/bchecker4.js';
import { poseBridgeChecker } from '../src/bchecker.js';
import { poseBackhoe } from '../src/backhoe.js';
import { poseRoughTerrainCrane } from '../src/rcrane.js';
import { poseCrawlerCrane } from '../src/ccrane.js';

const KIN = {
  bridge_checker4: poseBridgeChecker4,
  bridge_checker: poseBridgeChecker,
  backhoe: poseBackhoe,
  rough_terrain_crane: poseRoughTerrainCrane,
  crawler_crane: poseCrawlerCrane,
};

// ★index.html の既定値と合わせてある。片方だけ変えないこと
const DEFAULTS = {
  bridge_checker4: {
    outrigger: 2, angleSwing: 90, angleBoom1: 5, lengthBoom1: 6.88,
    angleBoom2: 0, angleSwivel: 0, angleBoom3: 0, lengthBoom3: 11.61,
    angleBoom4: -23, angleBasket: 0,
  },
  bridge_checker: {
    outrigger: 2, angleSwing: 0, angleBoom: 0, lengthBoom: 5.11,
    lengthPost: 9.5, lengthDeckboom: 6.0, angleDeck: 0,
  },
  backhoe: { angleCabin: 0, angleBoom: 30, angleArm: -100, angleBucket: 30, bucketType: 0 },
};

const here = dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
if (!id) { console.error('使い方: node tools/pose.mjs <機械id> [操作のJSON]'); process.exit(2); }
const M = JSON.parse(readFileSync(join(here, '..', 'machines', id + '.json'), 'utf8'));
const fn = KIN[M.type];
if (!fn) { console.error('姿勢計算が無い type: ' + M.type); process.exit(2); }

const st = { ...(DEFAULTS[M.type] || {}), ...JSON.parse(process.argv[3] || '{}') };
const r = fn(M, st, { point: [0, 0, 0], angle: 0 });

process.stdout.write(JSON.stringify({
  id, type: M.type, state: r.state || st, readouts: r.readouts || [],
  hidden: r.hidden || [], parts: r.parts,
}, null, 1) + '\n');
