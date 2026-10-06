# -*- coding: utf-8 -*-
"""ACIS SAT の記録を自分でたどる（曲面を三角形にするため）。

  ezdxf は平らな面しか返さない。曲面（円柱・円錐）は自分で作るしかない。
  最初は「同じ軸・同じ半径の円を並べて筒にする」でやったが、
  ★**関係のない穴どうしが繋がって、ブームが 2 倍の長さになった**。
  面をたどらないと、どの円とどの円が 1 つの筒なのか決まらない。

  なのでここでは face → loop → coedge → edge → curve と素直にたどる。
  必要なのは「cone-surface の面が持つ 2 つの円」だけなので、
  記録の形（並び）は下の読み取りに書いてある分だけで足りる。

  記録の並び（ASM / AutoCAD が DWG に書くもの。実物で確かめた）:
    face         $pattern $next_face $loop $shell $subshell $surface sense sided
    loop         $pattern $next_loop $coedge $face
    coedge       $pattern $next $prev $partner $edge sense $loop int $pcurve
    edge         $pattern $start_vertex t0 $end_vertex t1 $coedge $curve sense
    ellipse-curve $pattern cx cy cz nx ny nz mx my mz ratio ...
    straight-curve $pattern px py pz dx dy dz ...
    vertex       $pattern $edge n $point
    point        $pattern x y z
"""
import re
import numpy as np


class Rec:
    __slots__ = ("name", "data")

    def __init__(self, name, data):
        self.name = name
        self.data = data


def parse(text):
    """SAT の本文を記録の一覧にする。$n は添字の整数のまま残す"""
    lines = text.split("\n")
    body = "\n".join(lines[3:])
    recs = []
    for chunk in body.split("#"):
        chunk = chunk.strip()
        if not chunk:
            continue
        tok = chunk.split()
        if tok[0].startswith("-") and tok[0][1:].isdigit():
            tok.pop(0)
        name = tok[0]
        # name $attrib id  …  の 2 つを捨てる
        recs.append(Rec(name, tok[3:]))
    return recs


def ptr(tok):
    """$12 → 12 ／ $-1 → None"""
    if isinstance(tok, str) and tok.startswith("$"):
        n = int(tok[1:])
        return None if n < 0 else n
    return None


def num(tok):
    try:
        return float(tok)
    except (TypeError, ValueError):
        return None


def _ring(c, n, a, r, seg, t0=0.0, t1=2 * np.pi):
    """円（楕円）の弧の上の点。

    ★媒介変数の範囲を必ず使うこと。全部まるい 1 周だと思って作ると、
      隅の丸み（4 分の 1 の弧）が**まるごと 1 周の円**になって形が飛ぶ
      （キャビンが 7 倍になった原因）"""
    b = np.cross(n, a) * r
    span = t1 - t0
    closed = abs(abs(span) - 2 * np.pi) < 1e-6
    t = (np.linspace(t0, t1, seg, endpoint=False) if closed
         else np.linspace(t0, t1, max(seg // 2, 3)))
    return c + np.outer(np.cos(t), a) + np.outer(np.sin(t), b), closed


def body_transform(recs):
    """body が持つ transform を (3x3, 平行移動, 倍率) で返す。無ければ None。

    ★これを掛け忘れると形が飛ぶ。KATO のブーム 1〜3 は transform に
      (-9350, 800, 0) が入っていて、掛けないと部品が 9350mm 離れて置かれる
      （2026-09 にブロック定義を平行移動して直した、あのずれと同じ数）。
      ezdxf の mesh_from_body は掛けてくれるので、曲面側だけ忘れやすい。
        transform $pattern r11 r12 r13 r21 r22 r23 r31 r32 r33 tx ty tz scale …
    """
    for r in recs:
        if r.name != "body":
            continue
        ti = ptr(r.data[3]) if len(r.data) > 3 else None
        if ti is None or not recs[ti].name.endswith("transform"):
            return None
        d = [num(x) for x in recs[ti].data[:13]]
        if any(x is None for x in d):
            return None
        return np.array(d[0:9]).reshape(3, 3), np.array(d[9:12]), d[12]
    return None


def curved_faces(text, seg=16, flat_box=None):
    """曲面の面だけを三角形にして (頂点, 三角形) を返す。無ければ (None, None)"""
    recs = parse(text)
    xf = body_transform(recs)

    # ★立体の本当の広がりは point の記録（B-rep の頂点）で決まる。
    #   曲面から作った輪がここから大きく外れていたら、拾い方を間違えている。
    #   面の形はいろいろで一つずつ潰しきれないので、最後にこれで弾く
    pts = []
    for r in recs:
        if r.name == "point":
            v = [num(x) for x in r.data[1:4]]
            if all(x is not None for x in v):
                pts.append(v)
    # ★平らな面がある立体だけ縛る。棒や筒だけでできた部品（ワイヤ・
    #   起伏シリンダ）は頂点が 2 つしか無く、縛ると中身が全部消える
    if pts and flat_box is not None:
        pts = np.asarray(pts)
        blo = np.minimum(pts.min(axis=0), flat_box[0])
        bhi = np.maximum(pts.max(axis=0), flat_box[1])
        # ゆるめに取る。丸い屋根は平らな面より 300mm ほど高くなる。
        # 弾きたいのは「部品の 2 倍以上に伸びる」ような取り違えだけ
        pad = np.maximum((bhi - blo) * 0.5, 100.0)
        blo, bhi = blo - pad, bhi + pad
    else:
        blo = bhi = None

    def inside(p):
        return blo is None or (p.min(axis=0) >= blo).all() and (p.max(axis=0) <= bhi).all()
    V, T = [], []

    def ellipse_of(ci):
        """curve の記録が円（楕円）なら (中心, 単位法線, 長軸, 比)"""
        if ci is None or ci >= len(recs):
            return None
        r = recs[ci]
        if not r.name.endswith("ellipse-curve"):
            return None
        d = r.data
        v = [num(x) for x in d[1:11]]
        if any(x is None for x in v):
            return None
        c, n, a, ratio = np.array(v[0:3]), np.array(v[3:6]), np.array(v[6:9]), v[9]
        ln = np.linalg.norm(n)
        if ln < 1e-12 or np.linalg.norm(a) < 1e-9:
            return None
        return c, n / ln, a, ratio

    def loop_ellipses(li):
        """1 つのループが通る円を集める（coedge の輪をたどる）"""
        out = []
        if li is None:
            return out
        c0 = ptr(recs[li].data[2])
        ci, seen = c0, set()
        while ci is not None and ci not in seen:
            seen.add(ci)
            ce = recs[ci]
            # ★tcoedge-coedge / tedge-edge は並びが違う。読むと見当違いの
            #   円を拾って形が飛ぶ（キャビンが 7 倍になった）。数が少ないので飛ばす
            if ce.name != "coedge":
                break
            ei = ptr(ce.data[4])
            if ei is not None and recs[ei].name == "edge":
                el = ellipse_of(ptr(recs[ei].data[6]))
                if el is not None:
                    t0 = num(recs[ei].data[2])
                    t1 = num(recs[ei].data[4])
                    # ★範囲が数で書かれていないとき（"I" など）は捨てる。
                    #   「分からないから 1 周」にすると、半径 12m の
                    #   丸みがまるごと円になって部品が 5 倍に伸びる
                    if t0 is None or t1 is None:
                        ci = ptr(ce.data[1])
                        if ci == c0:
                            break
                        continue
                    out.append(el + (t0, t1))
            ci = ptr(ce.data[1])
            if ci == c0:
                break
        return out

    for r in recs:
        if r.name != "face":
            continue
        si = ptr(r.data[5])
        if si is None or not recs[si].name.endswith("cone-surface"):
            continue
        # この面が持つすべてのループの円を集める
        els = []
        li = ptr(r.data[2])
        seen = set()
        while li is not None and li not in seen:
            seen.add(li)
            els.extend(loop_ellipses(li))
            li = ptr(recs[li].data[1])
        # 同じ円が 2 回出ることがあるので中心でまとめる
        uniq = []
        for e in els:
            if not any(np.allclose(e[0], u[0], atol=1e-6) for u in uniq):
                uniq.append(e)
        if len(uniq) != 2:
            continue
        (c0, n0, a0, r0, s0, e0), (c1, n1, a1, r1, s1, e1) = uniq
        if np.dot(n0, n1) < 0:
            n1, a1 = -n1, a1
        a1u, a0u = a1 / np.linalg.norm(a1), a0 / np.linalg.norm(a0)
        if np.dot(a0u, a1u) < 0:
            a1 = -a1
        p0, cl0 = _ring(c0, n0, a0, r0, seg, s0, e0)
        p1, cl1 = _ring(c1, n0, a1, r1, seg, s1, e1)
        if len(p0) != len(p1) or not inside(p0) or not inside(p1):
            continue
        i0 = len(V); V.extend(map(tuple, p0))
        i1 = len(V); V.extend(map(tuple, p1))
        nn = len(p0)
        last = nn if (cl0 and cl1) else nn - 1
        for k in range(last):
            k2 = (k + 1) % nn
            T.append((i0 + k, i0 + k2, i1 + k2))
            T.append((i0 + k, i1 + k2, i1 + k))

    # 平らな面で、縁が円だけのもの（＝ふた）も ezdxf は返さないので足す
    for r in recs:
        if r.name != "face":
            continue
        si = ptr(r.data[5])
        if si is None or not recs[si].name.endswith("plane-surface"):
            continue
        li = ptr(r.data[2])
        if li is None or ptr(recs[li].data[1]) is not None:
            continue                      # ループが 2 つ以上＝穴あき。ふたにしない
        els = loop_ellipses(li)
        if len(els) != 1:
            continue
        c, n, a, ratio, t0, t1 = els[0]
        p, closed = _ring(c, n, a, ratio, seg, t0, t1)
        if not closed or not inside(p):
            continue                      # 丸くない縁はふたにしない
        i0 = len(V); V.extend(map(tuple, p))
        ic = len(V); V.append(tuple(c))
        nn = len(p)
        for k in range(nn):
            T.append((ic, i0 + k, i0 + (k + 1) % nn))

    if not T:
        return None, None
    arr = np.asarray(V, dtype=np.float64)
    if xf is not None:
        R, t, sc = xf
        arr = (arr @ R) * sc + t
    return arr, np.asarray(T, dtype=np.int64)
