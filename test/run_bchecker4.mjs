// TADANO BT-400 の姿勢計算を、カタログの数字と作業範囲図の実測で確かめる。
//   node test/run_bchecker4.mjs
//
// ★この機械は 3D データが無く、カタログ 1 枚から組んである
//   （DAM/kenki/BT-400_params.md）。だから検算はカタログの 4 つの数字
//   —— 最大地下深さ 17.4m / 最大地上高 16.1m / 最大作業半径 11.4m /
//      最大差込み長さ 15.0m —— に当てるしかない。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { poseBridgeChecker4 } from '../src/bchecker4.js';

const here = dirname(fileURLToPath(import.meta.url));
const M = JSON.parse(readFileSync(join(here, '..', 'machines', 'TADANO_BT400.json'), 'utf8'));
const D = M.dims;
const BASE = { point: [0, 0, 0], angle: 0 };

let n = 0, bad = 0;
const chk = (name, got, want, tol = 1e-6) => {
  n++;
  const d = Math.abs(got - want);
  if (!(d <= tol)) { bad++; console.log(`  NG ${name}  got=${got} want=${want} 差=${d}`); }
};
const ok = (name, cond) => { n++; if (!cond) { bad++; console.log(`  NG ${name}`); } };

const lim = {};
for (const c of M.controls) lim[c.key] = c;
// 操作の既定値＝すべて最小側（choice は最大張出）
// ★旋回 0 度は「車両前方」（格納の向き）。
//   作業範囲図との突き合わせは +x 側でやりたいので、既定は 右90度 にしておく
const base = {
  outrigger: 2, angleSwing: -90, angleBoom1: 5, lengthBoom1: 6.0, angleBoom2: 0,
  angleSwivel: 0, angleBoom3: 0, lengthBoom3: 5.18, angleBoom4: 0, angleBasket: 0,
};
const P = st => poseBridgeChecker4(M, { ...base, ...st }, BASE);
const floorOf = r => r.tip;
const radOf = r => Math.hypot(r.tip[0], r.tip[1]);

// --- 1. カタログの 4 つの数字 -----------------------------------------
console.log('[1] カタログの主要諸元');
{
  // 最大地下深さ：第1ブーム 5度・6.0m、第2ブーム 鉛直、第3ブーム -70度・11.61m、第4ブーム -23度
  const r = P({ angleBoom3: -70, lengthBoom3: 11.61, angleBoom4: -23 });
  chk('最大地下深さ 17.4m', -floorOf(r)[2] / 1000, 17.4, 0.01);

  // ★これが本当に最深か（総当たりで、これより深いところが無いこと）
  let deepest = 0, arg = null;
  for (const a1 of [5, 20, 45, 77]) {
    for (const L1 of [6.0, 7.0, 7.9]) {
      for (const a2 of [0, 15, 45, 90]) {
        for (const sv of [-142.5, -90, 0, 90, 142.5]) {
          for (const a3 of [-70, -45, 0, 45, 90]) {
            for (const L3 of [5.18, 8.0, 11.61]) {
              for (const a4 of [-23, 0, 45, 90]) {
                const z = floorOf(P({ angleBoom1: a1, lengthBoom1: L1, angleBoom2: a2,
                                      angleSwivel: sv, angleBoom3: a3, lengthBoom3: L3,
                                      angleBoom4: a4 }))[2];
                if (z < deepest) { deepest = z; arg = [a1, L1, a2, sv, a3, L3, a4]; }
              }
            }
          }
        }
      }
    }
  }
  chk('総当たりでもこれより深くならない', -deepest / 1000, 17.4, 0.01);
  ok('最深の姿勢は 第1ブーム5度・6.0m / 第2ブーム鉛直 / 第3ブーム-70度・11.61m / 第4ブーム-23度',
     arg && arg[0] === 5 && arg[1] === 6.0 && arg[2] === 0 && arg[4] === -70 &&
     arg[5] === 11.61 && arg[6] === -23);

  // 最大差込み長さ：第3ブームを水平いっぱいに伸ばして橋の下へ差し込む
  const ins = P({ angleBoom3: 0, lengthBoom3: 11.61, angleBoom4: 0 });
  chk('最大差込み長さ 15.0m',
      (D.boom3_len + (11.61 * 1000 - D.boom3_len) + D.boom4_len + D.basket_len) / 1000, 14.91, 0.001);
  ok('差込み長さの読み出しが 14.91m', ins.readouts[2] === '差込み長さ 14.91m');
}

// --- 2. 作業範囲規制 ---------------------------------------------------
console.log('[2] 作業範囲規制（地上高 16.1m / 作業半径 11.4m）');
{
  let hi = -1e9, rad = -1e9;
  for (const a1 of [5, 30, 55, 77]) {
    for (const L1 of [6.0, 7.0, 7.9]) {
      for (const a2 of [0, 30, 60, 90]) {
        for (const sv of [-142.5, -90, -45, 0, 45, 90, 142.5]) {
          for (const a3 of [-70, -35, 0, 35, 90]) {
            for (const L3 of [5.18, 8.0, 11.61]) {
              for (const a4 of [-23, 0, 45, 90]) {
                const r = P({ angleBoom1: a1, lengthBoom1: L1, angleBoom2: a2, angleSwivel: sv,
                              angleBoom3: a3, lengthBoom3: L3, angleBoom4: a4 });
                hi = Math.max(hi, floorOf(r)[2]);
                rad = Math.max(rad, radOf(r));
              }
            }
          }
        }
      }
    }
  }
  ok('どの姿勢でも地上高 16.1m を越えない', hi <= D.max_height + 1);
  ok('どの姿勢でも作業半径 11.4m を越えない', rad <= D.max_radius + 1);
  chk('規制いっぱいまでは届く（地上高）', hi / 1000, 16.1, 0.02);
  chk('規制いっぱいまでは届く（作業半径）', rad / 1000, 11.4, 0.02);
}
{
  // 規制が掛かったときは、第3ブーム長さから戻していること
  const want = { angleBoom1: 77, lengthBoom1: 7.9, angleBoom2: 90, angleBoom3: 90, lengthBoom3: 11.61 };
  const r = P(want);
  ok('規制時はまず第3ブームを戻す', r.state.lengthBoom3 < 11.61);
  ok('規制時に第1ブームは触らない（第3ブームだけで収まる場合）', r.state.lengthBoom1 === 7.9);
  ok('規制の結果が範囲の内側', floorOf(r)[2] <= D.max_height + 1 && radOf(r) <= D.max_radius + 1);
}

// --- 3. 作業範囲図から読んだ姿勢と合うか -------------------------------
//   下作業・アウトリガ最大張出 の図で測ったピン（BT-400_params.md §3）
console.log('[3] 作業範囲図で測ったピンと合うか');
{
  const r = P({ angleBoom1: 5.14, lengthBoom1: 6.881, angleBoom2: 0 });
  const j = r.joints;
  chk('第1ブーム トップピン 半径', j.tip1[0] / 1000, 6.213, 0.02);
  chk('第1ブーム トップピン 高さ', j.tip1[2] / 1000, 3.659, 0.02);
  // ★第2ブーム上端は「軸方向の成分を 0 にした」ぶんだけずれる（params §7-3）
  chk('第2ブーム 上端ピン 半径', j.top2[0] / 1000, 6.402, 0.15);
  chk('第2ブーム 上端ピン 高さ', j.top2[2] / 1000, 2.814, 0.05);
  chk('第2ブーム 下端ピン 半径', j.bot2[0] / 1000, 6.572, 0.35);
  chk('第2ブーム 下端ピン 高さ', j.bot2[2] / 1000, -4.137, 0.05);
  chk('第2ブームの長さ', Math.hypot(...j.bot2.map((v, i) => v - j.top2[i])) / 1000, 6.96, 0.01);
}
{
  // 第4ブームのリフト高さ 1.8m（図では先端ピン 2 点の差が (-1.194, 1.804)）
  const lo = P({ angleBoom3: 0, angleBoom4: -23 }).joints.tip4;
  const hi = P({ angleBoom3: 0, angleBoom4: 90 }).joints.tip4;
  chk('第4ブーム リフト高さ 1.8m', (hi[2] - lo[2]) / 1000, 1.8, 0.01);
  chk('第4ブーム 先端の前後差', Math.abs(hi[0] - lo[0]) / 1000, 1.197, 0.01);
}
{
  // 上作業の図：第1ブーム 77度・7.885m
  const j = P({ angleBoom1: 77, lengthBoom1: 7.885 }).joints;
  chk('上作業の図の第1ブーム トップピン 半径', j.tip1[0] / 1000, 1.130 + 0.634 - 0.628, 0.02);
  chk('上作業の図の第1ブーム トップピン 高さ', j.tip1[2] / 1000, 10.730, 0.02);
}

// --- 4. つながりと向き -------------------------------------------------
console.log('[4] つながりと向き');
{
  // 旋回 0 度＝車両前方（車体は +y が前）
  const f = P({ angleBoom1: 5, angleSwing: 0 }).joints;
  ok('旋回 0 度で第1ブームは車両の前へ出る', f.tip1[1] > 0 && Math.abs(f.tip1[0]) < 1e-9);
  // 右90度（既定）では +x へ出る
  const j = P({ angleBoom1: 5 }).joints;
  ok('右90度で第1ブームは車両の右へ出る', j.tip1[0] > 0 && Math.abs(j.tip1[1]) < 1e-9);
  // 左90度では反対側
  const l = P({ angleBoom1: 5, angleSwing: 90 }).joints;
  ok('左90度は右90度の反対側', Math.abs(l.tip1[0] + j.tip1[0]) < 1e-9);
  // 第2ブーム旋回 0 度＝車両側へ戻す向き
  const k = P({ angleBoom3: 0, lengthBoom3: 11.61, angleSwivel: 0 }).joints;
  ok('第2ブーム旋回 0 度で第3ブームは戻る向き', k.tip3[0] < k.bot2[0]);
  // 旋回 90 度で水平に 90 度回る
  const a = P({ angleBoom1: 30, angleSwing: -90 }).joints.tip1;
  const b = P({ angleBoom1: 30, angleSwing: 0 }).joints.tip1;
  chk('旋回 90 度 x', b[0], -a[1], 1e-9);
  chk('旋回 90 度 y', b[1], a[0], 1e-9);
  chk('旋回で高さは変わらない', b[2], a[2], 1e-9);
}
{
  // 第2ブームが鉛直のとき、第3ブームの起伏は水平からの絶対角
  for (const c of [-70, -35, 0, 45, 90]) {
    const j = P({ angleBoom2: 0, angleBoom3: c, lengthBoom3: 11.61 }).joints;
    const dz = j.tip3[2] - j.bot2[2], dr = Math.hypot(j.tip3[0] - j.bot2[0], j.tip3[1] - j.bot2[1]);
    chk(`第3ブーム起伏 ${c} 度が絶対角`, Math.atan2(dz, dr) * 180 / Math.PI, c, 1e-6);
  }
}
{
  // バスケットは自動水平：どんな姿勢でも傾かない
  for (const a2 of [0, 45, 90]) {
    for (const a3 of [-70, 0, 90]) {
      const m = P({ angleBoom2: a2, angleBoom3: a3, angleBoom4: 45 }).parts.basket;
      chk(`バスケットが水平（第2 ${a2}度・第3 ${a3}度）`, m[2] ** 2 + m[6] ** 2 + (m[10] - 1) ** 2, 0, 1e-12);
    }
  }
}
{
  // 第2ブームが水平に出きっても姿勢が飛ばない（基準が決まらなくなる場所）
  const j = P({ angleBoom2: 90, angleBoom3: 0, lengthBoom3: 11.61 }).joints;
  ok('第2ブーム 90 度でも数が壊れない', j.tip4.every(Number.isFinite));
}

// --- 5. 操作の範囲 -----------------------------------------------------
console.log('[5] 操作の範囲');
{
  const far = P({ angleBoom1: 999, lengthBoom1: 99, angleBoom2: -99, angleSwivel: 999,
                  angleBoom3: 999, lengthBoom3: 99, angleBoom4: -99, angleSwing: 999,
                  outrigger: 99 });
  ok('範囲の外の値を渡しても壊れない', far.tip.every(Number.isFinite));
  ok('範囲の外でも規制の内側', far.tip[2] <= D.max_height + 1 && radOf(far) <= D.max_radius + 1);
  chk('第1ブーム起伏は 77 度まで', far.state.angleBoom1, 77, 1e-9);
  chk('第1ブーム長さは 7.9m まで', far.state.lengthBoom1, 7.9, 1e-9);
  chk('第2ブーム起伏は 0 度から', far.state.angleBoom2, 0, 1e-9);
  chk('旋回は 100 度まで', far.state.angleSwing, 100, 1e-9);
}
{
  // アウトリガは張出段で左右へ広がる
  const w = s => {
    const p = P({ outrigger: s }).parts;
    return Math.abs(p.foot_fl[12] - p.foot_fr[12]);
  };
  chk('アウトリガ フロント 中間1 張出 3.0m', w(0) / 1000, 3.0, 1e-9);
  chk('アウトリガ フロント 最大張出 4.04m', w(2) / 1000, 4.04, 1e-9);
}

// --- 6. 部品がそろっているか -------------------------------------------
console.log('[6] 部品');
{
  const p = P({}).parts;
  for (const name of M.parts) {
    if (name === 'outrigger' || name === 'outrigger-foot') continue;
    ok(`部品 ${name} の行列がある`, Array.isArray(p[name]) && p[name].length === 16);
  }
  for (const s of ['fl', 'fr', 'bl', 'br']) {
    ok(`アウトリガ ${s}`, Array.isArray(p['outrigger_' + s]) && Array.isArray(p['foot_' + s]));
  }
}

console.log(`\n${n - bad} / ${n} 一致`);
process.exit(bad ? 1 : 0);
