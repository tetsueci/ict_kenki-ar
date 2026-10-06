// 定格荷重の引き方が、表の中身と合うかを見る。
//   node test/run_load.mjs
// ★表そのものは tools/xlsm_to_load.py が Excel と 620/620 一致を確かめている。
//   ここで見るのは「引き方」（どの段・どの行・どの列に落ちるか）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ratedLoad, LOAD_TRAVEL, LOAD_NG } from '../src/load.js';

const here = dirname(fileURLToPath(import.meta.url));
const L = JSON.parse(readFileSync(join(here, '..', 'machines', 'KATO_SR250Rf2.load.json'), 'utf8'));
const nb = L.boom.length, nr = L.radius.length;
const at = (o, r, b) => L.table[o * nr * nb + r * nb + b];

let n = 0, bad = 0;
const chk = (name, got, want) => {
  n++;
  const ok = (got === want) || (typeof got === 'number' && typeof want === 'number'
    && Math.abs(got - want) < 1e-9);
  if (!ok) { bad++; console.log(`  NG ${name}  got=${got} want=${want}`); }
};

// 1. 表のどのマスも、その条件ちょうどで引けば同じ値が出る
for (let o = 0; o < L.outrigger.length; o++) {
  for (let r = 0; r < nr; r++) {
    for (let b = 0; b < nb; b++) {
      const v = at(o, r, b);
      if (!v) continue;                       // 空欄は次の段へ流れるので別で見る
      // 同じ半径・同じブーム長さ・そのアウトリガちょうど
      const got = ratedLoad(L, {
        outrigger: L.outrigger[o], radius: L.radius[r], boomLength: L.boom[b],
      });
      chk(`段${o} 行${r} 列${b}`, got.value, v);
    }
  }
}

// 2. 境目の振るまい
const t = (o, r, b) => ratedLoad(L, { outrigger: o, radius: r, boomLength: b });
chk('走行状態（張出が最小未満）', t(2.0, 5, 10).text, LOAD_TRAVEL);
chk('半径が表の外', t(6.6, L.radius[nr - 1] + 0.1, 9.35).text, LOAD_NG);
chk('ブームが表の外', t(6.6, 5, L.boom[nb - 1] + 0.1).text, LOAD_NG);
// 半径は「その行以下になる最初の行」＝切り上げ
chk('半径 2.4 は 2.5 の行', t(6.6, 2.4, 9.35).value, at(0, 0, 0));
chk('半径 2.6 は 3.0 の行', t(6.6, 2.6, 9.35).value, at(0, 1, 0));
// 張出は「その段以上になる最初の段」＝切り下げ
chk('張出 6.3 は 6.1 の段', t(6.3, 5, 9.35).value, ratedLoad(L, { outrigger: 6.1, radius: 5, boomLength: 9.35 }).value);
// 空欄は長いブームへ流れる
{
  let found = null;
  for (let r = 0; r < nr && !found; r++)
    for (let b = 0; b < nb - 1; b++)
      if (!at(0, r, b) && at(0, r, b + 1)) { found = [r, b]; break; }
  if (found) {
    const [r, b] = found;
    chk(`空欄（行${r} 列${b}）は次の列へ`,
        t(L.outrigger[0], L.radius[r], L.boom[b]).value, at(0, r, b + 1));
  }
}

console.log(`\n${n - bad} / ${n} 一致`);
process.exit(bad ? 1 : 0);
