// 橋梁点検車（BT-200）の姿勢計算が、カタログの可動範囲と合うかを見る。
//   node test/run_bchecker.mjs
//
// ★3D データが無く、カタログの数字だけから組んだ機械なので、
//   突き合わせる相手は「カタログに載っている限界値」。
//   出どころ DAM/kenki/BT-200_params.md

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { poseBridgeChecker } from '../src/bchecker.js';

const here = dirname(fileURLToPath(import.meta.url));
const M = JSON.parse(readFileSync(join(here, '..', 'machines', 'TADANO_BT200.json'), 'utf8'));
const BASE = { point: [0, 0, 0], angle: 0 };

let n = 0, bad = 0;
const chk = (name, got, want, tol) => {
  n++;
  if (Math.abs(got - want) > tol) {
    bad++;
    console.log(`  NG ${name}  got=${got.toFixed(3)} want=${want} 差=${(got - want).toFixed(3)}`);
  }
};
const C = M.controls.reduce((o, c) => (o[c.key] = c, o), {});
const st = (o = {}) => ({
  outrigger: 2, angleSwing: 0, angleBoom: 0,
  lengthBoom: C.lengthBoom.min, lengthPost: C.lengthPost.min,
  lengthDeckboom: C.lengthDeckboom.min, angleDeck: 0, ...o,
});
const run = o => poseBridgeChecker(M, st(o), BASE);

// --- カタログの限界 ----------------------------------------------------
// 最大地上高 7.0m：ブーム上げ切り・最長・ポスト縮め切り
{
  const r = run({ angleBoom: C.angleBoom.max, lengthBoom: C.lengthBoom.max });
  chk('最大地上高（カタログ 7.0m）', r.deckHeight / 1000, 7.0, 0.08);
}
// 最大地下深さ 5.4m：ブーム下げ切り・最長・ポスト伸ばし切り
{
  const r = run({ angleBoom: C.angleBoom.min, lengthBoom: C.lengthBoom.max,
                  lengthPost: C.lengthPost.max });
  chk('最大地下深さ（カタログ 5.4m）', -r.deckHeight / 1000, 5.4, 0.08);
}

// --- 筋の通り方 --------------------------------------------------------
// ポストを伸ばした分だけデッキが下がる（ほかは動かない）
{
  const a = run({ angleBoom: 30, lengthPost: 4.0 });
  const b = run({ angleBoom: 30, lengthPost: 7.0 });
  chk('ポスト 3m 伸ばすとデッキが 3m 下がる', (a.deckHeight - b.deckHeight) / 1000, 3.0, 1e-9);
  chk('ポストを伸ばしても作業半径は変わらない', b.radius, a.radius, 1e-9);
}
// デッキブームを伸ばした分だけ作業半径が伸びる（高さは変わらない）
{
  const a = run({ lengthDeckboom: 4.0 });
  const b = run({ lengthDeckboom: 7.0 });
  chk('デッキブーム 3m で作業半径 +3m', (b.radius - a.radius) / 1000, 3.0, 1e-9);
  chk('デッキブームを伸ばしても高さは変わらない', b.deckHeight, a.deckHeight, 1e-9);
}
// ブーム起伏はデッキの高さを変えるが、ポストは鉛直のまま
{
  for (const ang of [-15, 0, 30, 60]) {
    const r = run({ angleBoom: ang, lengthBoom: 4.0 });
    const p0 = r.parts.post0, p4 = r.parts.post4;
    // 局所 +x が真下（列 0 が (0,0,-1)）であること＝つねに鉛直
    chk(`ポストが鉛直（ブーム ${ang}°）x`, p0[0], 0, 1e-12);
    chk(`ポストが鉛直（ブーム ${ang}°）y`, p0[1], 0, 1e-12);
    chk(`ポストが鉛直（ブーム ${ang}°）z`, p0[2], -1, 1e-12);
    chk(`最下段も鉛直（ブーム ${ang}°）z`, p4[2], -1, 1e-12);
  }
}
// デッキブームは水平（局所 +x の z 成分が 0）
{
  for (const ang of [-15, 30, 60]) {
    const r = run({ angleBoom: ang });
    chk(`デッキブームが水平（ブーム ${ang}°）`, r.parts.deckboom0[2], 0, 1e-12);
  }
}
// 旋回：作業半径と高さは変わらない。デッキは旋回中心から同じ距離
{
  const a = run({ angleSwing: 0, lengthDeckboom: 6.0 });
  const b = run({ angleSwing: 105, lengthDeckboom: 6.0 });
  chk('旋回しても作業半径は同じ', b.radius, a.radius, 1e-9);
  chk('旋回しても高さは同じ', b.deckHeight, a.deckHeight, 1e-9);
  let dd = (Math.atan2(b.tip[1], b.tip[0]) - Math.atan2(a.tip[1], a.tip[0])) * 180 / Math.PI;
  while (dd < -180) dd += 360;
  while (dd > 180) dd -= 360;
  chk('旋回 105° でデッキが回る', dd, 105 - 360 + 360, 1e-6);
}
// 伸縮の段が重ならずに並ぶ（ポスト）
{
  const r = run({ lengthPost: C.lengthPost.max });
  for (let i = 1; i < M.dims.post_stages; i++) {
    const dz = r.parts['post' + (i - 1)][14] - r.parts['post' + i][14];
    chk(`ポストの段 ${i} の下がり`, dz, 6500 / (M.dims.post_stages - 1), 1e-9);
  }
}
// 部品がそろっている
{
  const r = run();
  const want = M.parts.flatMap(p => p === 'outrigger' ? ['outrigger_fl','outrigger_fr','outrigger_bl','outrigger_br']
    : p === 'outrigger-foot' ? ['foot_fl','foot_fr','foot_bl','foot_br'] : [p]);
  for (const k of want) { n++; if (!(k in r.parts)) { bad++; console.log('  NG 部品が無い ' + k); } }
}

// --- ブーム旋回の向きと範囲 --------------------------------------------
// ★車体の座標では +y が前・+x が右。ブームが出る向きを「前から左回りに何度」で見る
{
  const dir = r => {
    const b = r.parts.boom0;                       // 局所 +x ＝ ブームの向き
    let t = Math.atan2(b[1], b[0]) * 180 / Math.PI - 90;   // 前（+y）から
    while (t < 0) t += 360;
    while (t >= 360) t -= 360;
    return t;
  };
  chk('旋回 0 でブームはほぼ真左（前から 85°）', dir(run()), 85, 1e-6);
  chk('右いっぱい（前から 75°）', dir(run({ angleSwing: C.angleSwing.min })), 75, 1e-6);
  chk('左いっぱい（前から 190°）', dir(run({ angleSwing: C.angleSwing.max })), 190, 1e-6);
  // ★範囲の外を渡しても、範囲の中に収まる
  chk('範囲より左へ回しても止まる', dir(run({ angleSwing: 300 })), 190, 1e-6);
  chk('範囲より右へ回しても止まる', dir(run({ angleSwing: -90 })), 75, 1e-6);
  chk('長さも範囲に収まる', run({ lengthPost: 99 }).deckHeight,
      run({ lengthPost: C.lengthPost.max }).deckHeight, 1e-9);
  // ★車両の右前には出ない（カタログ「車両右側での作業はできません」）
  for (let a = C.angleSwing.min; a <= C.angleSwing.max; a += 1) {
    const t = dir(run({ angleSwing: a }));
    n++;
    if (t < 75 - 1e-6 || t > 190 + 1e-6) {
      bad++; console.log('  NG 旋回 ' + a + '° で ブームが前から ' + t.toFixed(1) + '°（75〜190 の外）');
    }
  }
}

console.log(`\n${n - bad} / ${n} 一致`);
process.exit(bad ? 1 : 0);
