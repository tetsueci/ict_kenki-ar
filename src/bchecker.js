// 橋梁点検車（ブリッジチェッカー）の姿勢計算。TADANO BT-200。
//
// ★ほかの機械と違い、もとが図面のブロックではない。3D データが無く、
//   カタログ 1 枚（寸法と可動範囲）だけから組んである。
//   出どころと決め方は DAM/kenki/BT-200_params.md。
//
// ★つながり:
//     車体 → 旋回台（旋回）→ ブーム（起伏・伸縮）
//           → ポスト（★つねに鉛直・伸縮）→ デッキブーム（★つねに水平・伸縮）
//           → デッキ（旋回）
//   ブームで橋の欄干を越え、ポストを橋の下へ垂らし、
//   デッキブームを橋の下へ**戻す向き**に伸ばして床下へ入る。
//
// ★部品の行列は AutoCAD の OCS を通さず、素直に組む
//   （メッシュが CAD のブロックではなく tools/make_bt200.py が作った箱なので、
//    OCS に合わせる理由が無い）。

const D2R = Math.PI / 180;

// T(p) * Rz(yaw) * Ry(pitch) を列優先の 16 要素で
function mat(p, yaw, pitch) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  // ★pitch は「+ で上を向く」向きに取る（ブーム起伏角をそのまま入れるため）。
  //   ふつうの Ry は +x を下へ回すので、符号を逆にしてある
  return [
    c * cp, s * cp, sp, 0,
    -s, c, 0, 0,
    -c * sp, -s * sp, cp, 0,
    p[0], p[1], p[2], 1,
  ];
}

/**
 * @param {object} m   machines/TADANO_BT200.json
 * @param {object} st  { outrigger(段 0-2), angleSwing, angleBoom, lengthBoom(m),
 *                       lengthPost(m), lengthDeckboom(m), angleDeck }
 * @param {object} base { point:[x,y,z] WCS mm, angle: ラジアン }
 */
// 操作の値をカタログの範囲に収める。
//   ★スライダーの min/max だけに頼らない。範囲の外の値で呼ばれても
//     カタログに無い姿勢を作らないようにする（2026-10-15 ご指示）
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

export function poseBridgeChecker(m, st0, base) {
  const st = clamp(m, st0);
  const d = m.dims;
  const B = base.point || [0, 0, 0];
  const a0 = base.angle || 0;                 // 車体の向き
  const parts = {}, hidden = [];

  // 車体の座標 → 世界座標
  const at = (x, y, z) => [B[0] + x * Math.cos(a0) - y * Math.sin(a0),
                           B[1] + x * Math.sin(a0) + y * Math.cos(a0),
                           B[2] + z];

  parts.body = mat(at(0, 0, 0), a0, 0);

  // --- アウトリガ -------------------------------------------------------
  //   ★スライドするのは左側だけ（カタログ）。右側は中間1の幅で固定。
  //     カタログの数字はタイヤ中心での「全幅」なので、右半分を引いて左の張出にする
  const stage = Math.max(0, Math.min(2, st.outrigger | 0));
  //   ★記号は fr / fl / br / bl。ページ側が 1 つのメッシュを 4 つに複製する
  //     ときの決まり（index.html の COPIES）に合わせてある
  [['f', d.outrigger_front, d.body_to_outrigger_f],
   ['b', d.outrigger_rear, d.body_to_outrigger_r]].forEach(([k, w, y]) => {
    const right = w[0] / 2;                   // 中間1 の半分＝右側の固定幅
    const left = w[stage] - right;
    [['l', left, 1], ['r', right, -1]].forEach(([side, len, sgn]) => {
      const nm = 'outrigger_' + k + side;
      // 付け根は車体の側面。+x が張り出す向き
      const yaw = a0 + (sgn > 0 ? 0 : Math.PI);
      const p = at(sgn * d.outrigger_base, y, d.outrigger_z);
      parts[nm] = mat(p, yaw, 0);
      const fp = at(sgn * len, y, d.outrigger_z);
      parts['foot_' + k + side] = mat(fp, yaw, 0);
      // 伸ばしたぶんだけビームを伸ばす（箱を x 方向に伸ばす）
      const sc = (len - d.outrigger_base) / 1500;
      parts[nm] = scaleX(parts[nm], Math.max(sc, 0.2));
    });
  });

  // --- 旋回台 -----------------------------------------------------------
  //   ★ブームが出る向きは「車両の前」から左回りに測る。
  //     カタログのブーム旋回範囲図をベクトルで測ると、扇形の両端は
  //       ・真左から前へ 15°（＝前から 75°）
  //       ・真後ろから右へ 10°（＝前から 190°）
  //     で、開きは 115°。主要諸元の「旋回速度 115°/40s」と一致する。
  //     「旋回角度 左側105°、右側10°」はこの扇形を基準位置から言ったもので、
  //     基準位置は前から 85°（ほぼ真左）になる。
  //   ★車両右側では作業できない（カタログ注記）。真右を向くことは無い
  const s = a0 + Math.PI / 2 + (d.swing_zero_from_front + st.angleSwing) * D2R;
  parts.turret = mat(at(0, 0, 0), s, 0);

  // ブームの面の座標 (X, Z) → 世界座標。X は「ブームが出る向き」
  const pw = (X, Z) => [B[0] + X * Math.cos(s), B[1] + X * Math.sin(s), B[2] + Z];

  // --- ブーム -----------------------------------------------------------
  const ang = st.angleBoom * D2R;
  const L = st.lengthBoom * 1000;
  const footX = d.swing_to_boomfoot[0], footZ = d.swing_to_boomfoot[1];
  const ca = Math.cos(ang), sa = Math.sin(ang);
  parts.boom0 = mat(pw(footX, footZ), s, ang);
  parts.boom1 = mat(pw(footX + (L - d.boom_len) * ca,
                       footZ + (L - d.boom_len) * sa), s, ang);

  const tipX = footX + L * ca, tipZ = footZ + L * sa;

  // --- ポスト（つねに鉛直）-----------------------------------------------
  //   ★伸びた分だけ下がる。段は 4 つ動いて 1 段あたり e/4
  const e = Math.max(0, st.lengthPost * 1000 - d.post_len);
  const top = tipZ + d.post_len - d.boomtip_to_deckboom;   // ポスト上端（縮めたとき）
  for (let i = 0; i < d.post_stages; i++) {
    // 局所 +x を下向きに（pitch = -90°）
    parts['post' + i] = mat(pw(tipX, top - i * (e / (d.post_stages - 1))),
                            s, -Math.PI / 2);
  }
  const deckZ = tipZ - d.boomtip_to_deckboom - e;

  // --- デッキブーム（つねに水平・ブームと逆向きへ出る）--------------------
  const D = st.lengthDeckboom * 1000;
  const dext = Math.max(0, D - d.deckboom_len);
  for (let j = 0; j < d.deckboom_stages; j++) {
    const off = j * (dext / (d.deckboom_stages - 1));
    parts['deckboom' + j] = mat(pw(tipX - off, deckZ), s + Math.PI, 0);
  }

  // --- デッキ -----------------------------------------------------------
  const deckX = tipX - D;
  parts.deck = mat(pw(deckX, deckZ), s + Math.PI + st.angleDeck * D2R, 0);

  // --- 画面に出す値 -----------------------------------------------------
  const radius = Math.abs(deckX);
  const tip = pw(deckX, deckZ);
  return {
    parts, hidden, radius, tip,
    deckHeight: deckZ,
    readouts: [
      `作業半径 ${(radius / 1000).toFixed(2)}m`,
      deckZ >= 0 ? `デッキ地上高 ${(deckZ / 1000).toFixed(2)}m`
                 : `デッキ地下深さ ${(-deckZ / 1000).toFixed(2)}m`,
    ],
  };
}

// x 方向だけ伸ばす（アウトリガのビーム）
function scaleX(mx, k) {
  const o = mx.slice();
  o[0] *= k; o[1] *= k; o[2] *= k;
  return o;
}
