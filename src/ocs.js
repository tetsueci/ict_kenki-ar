// AutoCAD の OCS（図形座標系）。%library.lsp の vh-xyz / trans-x を写したもの。
//
// ★重機のモデルは「ブーム用の鉛直な面」を法線に持つ INSERT として置かれている。
//   だから OCS を正しく写せないと、ブームが平面図のように寝てしまう。
//
// 対応する LISP: %library.lsp の vh-xyz(L3913) / trans-x(L3960)

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const unit = a => { const d = len(a); return d < 1e-8 ? [0, 0, 0] : mul(a, 1 / d); };
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// vh-xyz: 法線 N から OCS の 3 軸 (Ax, Ay, Az) を作る。
//   AutoCAD の Arbitrary Axis Algorithm と同じ。しきい値 1/64 も同じ。
export function axes(normal) {
  const z = unit(normal);
  const [nx, ny, nz] = z;
  let x;
  if (Math.abs(nx) <= 0.015625 && Math.abs(ny) <= 0.015625) {
    // ★ほぼ鉛直の枝。library の 2026-08-13 の修正ぶん（下向きで X 軸が逆になっていた）
    //   を含む形で写してある。N=(0,0,1) なら Ax=(1,0,0)
    const t = (nx / nz) ** 2;
    const zz = (nx * nz > 0 ? -1 : 1) * Math.sqrt(t / (1 + t));
    const sg = nz > 0 ? 1 : -1;
    x = [sg * Math.sqrt(1 - zz * zz), 0, sg * zz];
  } else {
    x = unit([-ny, nx, 0]);
  }
  const y = cross(z, x);
  return [x, y, cross(x, y)];
}

// OCS(n1) の点 → WCS
export function toWorld(p, n1) {
  const [ax, ay, az] = axes(n1);
  return add(add(mul(ax, p[0]), mul(ay, p[1])), mul(az, p[2]));
}

// WCS の点 → OCS(n2)
export function toOcs(p, n2) {
  const [ax, ay, az] = axes(n2);
  return [dot(p, ax), dot(p, ay), dot(p, az)];
}

// trans-x(P, N1, N2): OCS(N1) の点を OCS(N2) の値に直す
export function transX(p, n1, n2) {
  return toOcs(toWorld(p, n1), n2);
}

// INSERT 1 個ぶんの世界行列（列優先の 16 要素。three.js の Matrix4.fromArray に渡せる）
//   ブロック内の点 b は   world = A(N) * ( p_ocs + Rz(rot) * S * b )
//   ocsPoint … group 10（OCS）／ normal … group 210 ／ rot … group 50（ラジアン）
export function insertMatrix(ocsPoint, normal, rot, scale = [1, 1, 1]) {
  const [ax, ay, az] = axes(normal);
  const c = Math.cos(rot), s = Math.sin(rot);
  // M3 = A * Rz * S   （A は列が ax, ay, az の行列）
  const col = (bx, by, bz) => [
    ax[0] * bx + ay[0] * by + az[0] * bz,
    ax[1] * bx + ay[1] * by + az[1] * bz,
    ax[2] * bx + ay[2] * by + az[2] * bz,
  ];
  const c0 = col(c * scale[0], s * scale[0], 0);
  const c1 = col(-s * scale[1], c * scale[1], 0);
  const c2 = col(0, 0, scale[2]);
  const t = col(ocsPoint[0], ocsPoint[1], ocsPoint[2]);
  return [
    c0[0], c0[1], c0[2], 0,
    c1[0], c1[1], c1[2], 0,
    c2[0], c2[1], c2[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

// 世界行列から挿入点（並進）だけ取り出す
export const matrixOrigin = m => [m[12], m[13], m[14]];
