// 橋梁点検車（ブリッジチェッカー）TADANO BT-400 の姿勢計算。
//
// ★BT-200（src/bchecker.js）とは腕の組み方がまったく違うので、別のファイルにした。
//   BT-200 は「ブーム＋鉛直ポスト＋水平デッキブーム」の 3 節。
//   BT-400 は**関節が 4 つ**あり、第2ブームの軸まわりに下半分が 285° まわる。
//
// ★もとが図面のブロックではない。3D データが無く、カタログ 1 枚
//   （DAM/kenki/doc_tadano_bt-200_bt-110_bt-400_lineup_brochure_metric.pdf 9〜10 頁）
//   だけから組んである。出どころと決め方は DAM/kenki/BT-400_params.md。
//
// ★つながり:
//     車体 → 旋回台（旋回 ±100°）
//          → 第1ブーム（起伏 5〜77°・伸縮 6.0〜7.9m）
//          → 第2ブーム（起伏 0°=鉛直下向き〜90°=水平・長さ 6.96m 固定）
//          → 【第2ブームの軸まわりに 285° 旋回】
//          → 第3ブーム（起伏 −70〜90°・伸縮 5.18〜11.61m）
//          → 第4ブーム（起伏 −23〜90°・長さ 1.3m）
//          → バスケット（★つねに水平・首振り 右100〜左90°）
//   第1ブームで高欄を越え、第2ブームを橋の外へ垂らし、
//   第3ブームを 180° 旋回させて**橋の下へ戻す向き**に差し込む。

const D2R = Math.PI / 180;

// --- ベクトル ---------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
                         a[2] * b[0] - a[0] * b[2],
                         a[0] * b[1] - a[1] * b[0]];
const norm = a => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return mul(a, 1 / n); };

/** 部品の行列（列優先 16 要素）。+x を dir に向け、ref の側を「上」にする */
function frame(p, dir, ref) {
  const x = norm(dir);
  let y = cross(ref || [0, 0, 1], x);
  if (Math.hypot(y[0], y[1], y[2]) < 1e-9) y = cross([1, 0, 0], x);
  y = norm(y);
  const z = cross(x, y);
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0,
          p[0], p[1], p[2], 1];
}

/** 水平に yaw だけ回した行列（車体・旋回台・バスケットなど） */
function yawMat(p, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1];
}

/** 操作の値をカタログの範囲に収める（スライダーの外から呼ばれても崩れないように） */
function clamp(m, st) {
  const o = { ...st };
  for (const c of m.controls) {
    if (c.type === 'choice') {
      const n = (m[c.from] || []).length;
      o[c.key] = Math.max(0, Math.min(n - 1, o[c.key] | 0));
    } else if (typeof c.min === 'number') {
      o[c.key] = Math.max(c.min, Math.min(c.max, +o[c.key]));
    }
  }
  return o;
}

/** 腕だけを組む。規制を掛けるために何度も呼ぶので、ここは副作用なし */
function arm(d, st, B, a0) {
  const sw = a0 + (d.swing_zero_from_front + st.angleSwing) * D2R;
  const ex = [Math.cos(sw), Math.sin(sw), 0];      // 旋回台の「ブームが出る向き」
  const up = [0, 0, 1];

  // --- 第1ブーム -------------------------------------------------------
  const a1 = st.angleBoom1 * D2R;
  const foot = add(B, add(mul(ex, d.swing_to_boomfoot[0]), [0, 0, d.swing_to_boomfoot[1]]));
  const u1 = add(mul(ex, Math.cos(a1)), mul(up, Math.sin(a1)));      // ブームの向き
  const n1 = add(mul(ex, -Math.sin(a1)), mul(up, Math.cos(a1)));     // その直角（上）
  const L1 = st.lengthBoom1 * 1000;
  const tip1 = add(foot, mul(u1, L1));

  // --- 第2ブーム（上端はブーム軸の直角下 880mm）-------------------------
  const top2 = add(tip1, mul(n1, -d.boom1tip_to_boom2));
  const a2 = st.angleBoom2 * D2R;              // 0 = 鉛直下向き / 90 = 水平
  const u2 = add(mul(ex, Math.sin(a2)), mul(up, -Math.cos(a2)));
  const bot2 = add(top2, mul(u2, d.boom2_len));

  // --- 第2ブームの軸まわりの旋回（285°）--------------------------------
  //   ★基準（0°）は「橋の下へ戻す向き」＝第1ブームと逆。
  //     第1ブームと同じ向きを基準にすると、差込み姿勢の 180° が範囲の外になる
  //   ★第2ブームが水平に出きると back と u2 が重なって基準が決まらなくなる。
  //     そのときだけ「上」を基準にする（0 除算で姿勢が飛ぶのを防ぐ）
  let back = mul(ex, -1);
  if (Math.abs(dot(back, u2)) > 1 - 1e-9) back = up;
  const r0 = norm(sub(back, mul(u2, dot(back, u2))));   // u2 に直角な基準
  const t0 = cross(u2, r0);
  const sv = st.angleSwivel * D2R;
  const s = add(mul(r0, Math.cos(sv)), mul(t0, Math.sin(sv)));   // 旋回後の「出る向き」

  // --- 第3ブーム・第4ブーム --------------------------------------------
  //   ★起伏は「水平からの絶対角」。第2ブームの軸まわりの旋回が決めるのは
  //     【水平の向き（方位）だけ】で、上下の角は第2ブームの傾きに引きずられない。
  //     s をそのまま使って cos(c)*s - sin(c)*u2 とすると、第2ブームを 15 度
  //     傾けただけで第3ブーム -70 度が実際には -85 度になり、
  //     最大地下深さが 18.1m まで伸びてしまう（検算で見つけた）。
  //   実機も各ブームを対地角で制御している（バスケットの自動水平装置と同じ考え）
  let sh = [s[0], s[1], 0];
  if (Math.hypot(sh[0], sh[1]) < 1e-9) sh = [r0[0], r0[1], 0];   // s が鉛直になったとき
  sh = norm(sh);
  const dir = c => add(mul(sh, Math.cos(c)), [0, 0, Math.sin(c)]);
  const u3 = dir(st.angleBoom3 * D2R);
  const u4 = dir(st.angleBoom4 * D2R);
  const L3 = st.lengthBoom3 * 1000;
  const tip3 = add(bot2, mul(u3, L3));
  const tip4 = add(tip3, mul(u4, d.boom4_len));
  // バスケットは自動水平。先端ピンから鉛直に下げるだけ
  const floor = add(tip4, [0, 0, -d.boom4tip_to_floor]);
  return { sw, ex, foot, u1, n1, L1, tip1, top2, u2, bot2, s, sh, u3, u4, L3, tip3, tip4, floor };
}

/**
 * @param {object} m   machines/TADANO_BT400.json
 * @param {object} st  { outrigger, angleSwing, angleBoom1, lengthBoom1(m), angleBoom2,
 *                       angleSwivel, angleBoom3, lengthBoom3(m), angleBoom4, angleBasket }
 * @param {object} base { point:[x,y,z] WCS mm, angle: ラジアン }
 */
export function poseBridgeChecker4(m, st0, base) {
  let st = clamp(m, st0);
  const d = m.dims;
  const B = base.point || [0, 0, 0];
  const a0 = base.angle || 0;
  const parts = {}, hidden = [];

  // --- ★作業範囲規制 ---------------------------------------------------
  //   関節の範囲をそのまま掛けると 地上高 20.7m・作業半径 25m まで届いてしまう。
  //   カタログは 16.1m・11.4m で、実機には作業範囲規制装置・干渉防止装置が付く。
  //   バスケット床が外れたら【第3ブーム長さ → 第2ブーム起伏 → 第1ブーム長さ】
  //   の順に戻す（実機でいちばん軽く戻せる順）。
  //   ★地下深さは規制しない。関節の範囲だけで最深がちょうど 17.4m になる
  const over = s => (s.floor[2] - B[2] - d.max_height > 1e-6) ||
                    (Math.hypot(s.floor[0] - B[0], s.floor[1] - B[1]) - d.max_radius > 1e-6);
  const lim = {};
  for (const c of m.controls) lim[c.key] = c;
  for (const key of ['lengthBoom3', 'angleBoom2', 'lengthBoom1']) {
    if (!over(arm(d, st, B, a0))) break;
    const bottom = lim[key].min;
    // 下限まで戻しても外れるなら、下限にしてから次の操作へ進む
    if (over(arm(d, { ...st, [key]: bottom }, B, a0))) { st = { ...st, [key]: bottom }; continue; }
    let lo = bottom, hi = st[key];               // lo は範囲内・hi は範囲外
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (over(arm(d, { ...st, [key]: mid }, B, a0))) hi = mid; else lo = mid;
    }
    st = { ...st, [key]: lo };
    break;
  }

  const r = arm(d, st, B, a0);

  // --- 部品の行列 -------------------------------------------------------
  parts.body = yawMat(B, a0);
  parts.turret = yawMat(B, r.sw);

  // アウトリガ。前後それぞれ、左右に張り出す
  const stage = Math.max(0, Math.min((m.stages || []).length - 1, st.outrigger | 0));
  const at = (x, y, z) => [B[0] + x * Math.cos(a0) - y * Math.sin(a0),
                           B[1] + x * Math.sin(a0) + y * Math.cos(a0), B[2] + z];
  for (const [k, w, y] of [['f', d.outrigger_front, d.body_to_outrigger_f],
                           ['b', d.outrigger_rear, d.body_to_outrigger_r]]) {
    // ★車体は +y が前・+x が右。だから +x 側が 'r'
    for (const [side, sgn] of [['r', 1], ['l', -1]]) {
      const half = w[stage] / 2;
      const yaw = a0 + (sgn > 0 ? 0 : Math.PI);
      parts['outrigger_' + k + side] =
        scaleX(yawMat(at(sgn * d.outrigger_base, y, d.outrigger_z), yaw),
               Math.max((half - d.outrigger_base) / d.outrigger_beam, 0.2));
      parts['foot_' + k + side] = yawMat(at(sgn * half, y, d.outrigger_z), yaw);
    }
  }

  // 第1ブーム 2 段。先の段ほど、伸びた分だけ前に出る
  const ext1 = r.L1 - d.boom1_len;
  for (let i = 0; i < d.boom1_stages; i++) {
    parts['boom1_' + i] =
      frame(add(r.foot, mul(r.u1, i * ext1 / (d.boom1_stages - 1))), r.u1, r.n1);
  }
  parts.boom2 = frame(r.top2, r.u2, r.s);        // 第2ブーム（1 本もの）
  // 第3ブーム 3 段同時伸縮
  const ext3 = r.L3 - d.boom3_len;
  for (let i = 0; i < d.boom3_stages; i++) {
    parts['boom3_' + i] =
      frame(add(r.bot2, mul(r.u3, i * ext3 / (d.boom3_stages - 1))), r.u3, [0, 0, 1]);
  }
  parts.boom4 = frame(r.tip3, r.u4, [0, 0, 1]);
  // バスケットはつねに水平。向きは第3ブームの出る向き＋首振り
  parts.basket = yawMat(r.floor, Math.atan2(r.sh[1], r.sh[0]) + st.angleBasket * D2R);

  // --- 画面に出す値 -----------------------------------------------------
  const radius = Math.hypot(r.floor[0] - B[0], r.floor[1] - B[1]);
  const z = r.floor[2] - B[2];
  // 差込み長さ＝第2ブームの軸から、バスケットの先の端までの水平距離
  const ins = Math.hypot(r.floor[0] - r.bot2[0], r.floor[1] - r.bot2[1]) + d.basket_len;
  return {
    parts, hidden, radius, tip: r.floor, state: st, joints: r,
    readouts: [
      `作業半径 ${(radius / 1000).toFixed(2)}m`,
      z >= 0 ? `バスケット地上高 ${(z / 1000).toFixed(2)}m`
             : `バスケット地下深さ ${(-z / 1000).toFixed(2)}m`,
      `差込み長さ ${(ins / 1000).toFixed(2)}m`,
    ],
  };
}

// x 方向だけ伸ばす（アウトリガのビーム）
function scaleX(mx, k) {
  const o = mx.slice();
  o[0] *= k; o[1] *= k; o[2] *= k;
  return o;
}
