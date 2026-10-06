// 定格荷重を表から引く。
// terra-maniyac.lsp の action_rcrane（L1222-1246）と同じ引き方。
//
// ★ただし単位はそろえてある。もとのコードは
//     ls_load_radius … m を 1000 倍して mm
//     ls_load_boom   … m のまま
//   なのに、どちらも mm の値（real_radius_s / length_boom）と比べており、
//   ブームの側は**どの行にも当たらない**（9350 <= 9.35 は成り立たない）。
//   ここでは表と同じ **メートル** で通す。
//
// 引き方:
//   アウトリガ … いまの張出が「その段以上」になる最初の段
//                （表は 6.6 / 6.1 / 5 / 3.8 / 2.31 と大きい順）。
//                どれにも届かなければ「走行状態」
//   作業半径   … いまの半径が「その行以下」になる最初の行（小さい順）
//   ブーム長さ … いまの長さが「その列以下」になる最初の列（小さい順）
//   表の値が 0（空欄＝不可）なら、ブームを 1 段ずつ長い側へずらして探す
//   それでも 0 なら吊れない

export const LOAD_NA = '表なし';
export const LOAD_TRAVEL = '走行状態';
export const LOAD_NG = '吊れない';

/**
 * @param {object} L  machines/<機械>.load.json
 * @param {object} st { outrigger, radius, boomLength } すべてメートル
 * @returns {{value:number|null, text:string, cell:object|null}}
 */
export function ratedLoad(L, st) {
  if (!L || !L.table) return { value: null, text: LOAD_NA, cell: null };
  const no = L.outrigger.length, nr = L.radius.length, nb = L.boom.length;

  const oi = L.outrigger.findIndex(a => st.outrigger >= a);
  if (oi < 0) return { value: null, text: LOAD_TRAVEL, cell: null };

  const ri = L.radius.findIndex(a => st.radius <= a);
  let bi = L.boom.findIndex(a => st.boomLength <= a);
  if (ri < 0 || bi < 0) return { value: null, text: LOAD_NG, cell: null };

  let v = L.table[oi * nr * nb + ri * nb + bi];
  // ★空欄のときは長いブームの段へずらす（もとのコードと同じ）
  while (!v && bi + 1 < nb) {
    bi += 1;
    v = L.table[oi * nr * nb + ri * nb + bi];
  }
  if (!v) return { value: null, text: LOAD_NG, cell: null };
  return {
    value: v,
    text: v.toFixed(2) + (L.unitWeight || 't'),
    cell: { outrigger: L.outrigger[oi], radius: L.radius[ri], boom: L.boom[bi] },
  };
}
