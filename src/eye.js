// 搭乗したときの目の位置を世界座標で出す。
//
// ★置き場所は machines/<機械>.json の eye。
//   point / forward / up は **その部品のブロックの座標**（mm）なので、
//   姿勢計算が返した行列（parts[eye.part]）を掛けて世界座標にする。
//   機械ごとに「どの部品に付いているか」が違う（いまはどちらも cabin）。
//
// 使い方:
//   const r = poseBackhoe(M, st, base);
//   const e = eyeWorld(M, r);     // { point, forward, up }  単位 mm
//   // three.js なら 0.001 を掛けてメートルに

/**
 * @param {object} m  machines/<機械>.json
 * @param {object} r  pose*() が返したもの（r.parts に部品ごとの世界行列）
 * @returns {{point:number[], forward:number[], up:number[]}|null}
 */
export function eyeWorld(m, r) {
  const e = m && m.eye;
  if (!e || !r || !r.parts) return null;
  const mx = r.parts[e.part];
  if (!mx) return null;

  // 列優先の 16 要素。点は w=1、向きは w=0（平行移動を掛けない）
  const apply = (v, w) => [
    mx[0] * v[0] + mx[4] * v[1] + mx[8] * v[2] + w * mx[12],
    mx[1] * v[0] + mx[5] * v[1] + mx[9] * v[2] + w * mx[13],
    mx[2] * v[0] + mx[6] * v[1] + mx[10] * v[2] + w * mx[14],
  ];
  const unit = v => {
    const d = Math.hypot(v[0], v[1], v[2]);
    return d < 1e-9 ? v : [v[0] / d, v[1] / d, v[2] / d];
  };
  return {
    point: apply(e.point, 1),
    forward: unit(apply(e.forward || [1, 0, 0], 0)),
    up: unit(apply(e.up || [0, 0, 1], 0)),
  };
}
