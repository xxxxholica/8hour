import type { Memo, Point, Stroke } from "./types";

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 点 p から線分 ab までの最短距離。 */
export function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const proj: Point = { x: a.x + t * abx, y: a.y + t * aby };
  return distance(p, proj);
}

/** 点 p がストローク（折れ線）から threshold 以内にあるか。 */
export function pointNearStroke(p: Point, stroke: Stroke, threshold: number): boolean {
  if (stroke.length === 0) return false;
  if (stroke.length === 1) return distance(p, stroke[0]) <= threshold;
  for (let i = 0; i < stroke.length - 1; i++) {
    if (pointToSegmentDistance(p, stroke[i], stroke[i + 1]) <= threshold) {
      return true;
    }
  }
  return false;
}

/** 点 p がメモを構成するいずれかのストロークから threshold 以内にあるか。 */
export function pointNearStrokes(p: Point, strokes: Stroke[], threshold: number): boolean {
  return strokes.some((s) => pointNearStroke(p, s, threshold));
}

/**
 * 円（center中心・半径radius）が、中心(box.x, box.y)を持つ矩形(box.width x box.height)と
 * 重なっているか。テキストメモの当たり判定（なぞって復活・消しゴム）に使う
 * ——矩形に最も近い円周上の点との距離で判定する標準的な円と矩形の衝突判定。
 */
export function circleIntersectsBox(
  center: Point,
  radius: number,
  box: { x: number; y: number; width: number; height: number }
): boolean {
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const closestX = Math.max(box.x - halfW, Math.min(center.x, box.x + halfW));
  const closestY = Math.max(box.y - halfH, Math.min(center.y, box.y + halfH));
  return distance(center, { x: closestX, y: closestY }) <= radius;
}

/**
 * pがclampの境界の内側にあるか。clamp系の関数（clampToRect等）は境界の
 * 内側の点を値そのまま返す実装になっているため、clamp(p)とpを値比較するだけで
 * 内外判定できる（restrictTranslationの内側判定と同じイディオム）。
 */
export function isInsideClamp(p: Point, clamp: (p: Point) => Point): boolean {
  const clamped = clamp(p);
  return clamped.x === p.x && clamped.y === p.y;
}

/**
 * 点群（ストロークを構成する全ての点）を (dx, dy) だけ剛体移動しようとしたとき、
 * 移動後に境界の外へ出る点が1つでもあれば、全ての点が境界内に収まる範囲まで
 * 移動量を比例的に縮める（2分探索）。個々の点を境界へ独立にスナップする
 * （clampToRect等をmapで適用する）方式は、境界に近い点ほど個別に丸め込まれて
 * 線全体の形が歪んでしまうため、代わりに移動そのものを制限する
 * ——「ストローク全体が境界内に収まらない移動は行わない」という方針
 * （ユーザー指示）。dx=dy=0、または元々1点も境界内に収まらない状態からの
 * 呼び出しは、移動量0（{dx:0, dy:0}）を返す。
 */
export function restrictTranslation(
  points: readonly Point[],
  dx: number,
  dy: number,
  clamp: (p: Point) => Point
): { dx: number; dy: number } {
  if (dx === 0 && dy === 0) return { dx: 0, dy: 0 };

  const fits = (t: number): boolean =>
    points.every((p) => isInsideClamp({ x: p.x + dx * t, y: p.y + dy * t }, clamp));

  if (fits(1)) return { dx, dy };
  if (!fits(0)) return { dx: 0, dy: 0 };

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return { dx: dx * lo, dy: dy * lo };
}

/** 中心center・半幅halfWidth・半高halfHeightの矩形の四隅の座標を返す。 */
export function boxCorners(center: Point, halfWidth: number, halfHeight: number): Point[] {
  return [
    { x: center.x - halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y - halfHeight },
    { x: center.x - halfWidth, y: center.y + halfHeight },
    { x: center.x + halfWidth, y: center.y + halfHeight },
  ];
}

/**
 * 消しゴム: center から radius 以内にある点をストロークから取り除く。
 * 取り除いた場所でストロークが分断される場合は、複数の断片に分けて返す
 * （2点未満になった断片は消える）。全く消えなければ元と同じ内容の1本を返す。
 */
export function eraseFromStroke(stroke: Stroke, center: Point, radius: number): Stroke[] {
  const touched = stroke.some((p) => distance(p, center) <= radius);
  if (!touched) return [stroke];

  const segments: Stroke[] = [];
  let current: Stroke = [];
  for (const p of stroke) {
    if (distance(p, center) <= radius) {
      if (current.length >= 2) segments.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

/**
 * 矩形領域（原点中心、半幅halfW・半高halfH）の内側に点を丸め込む。
 * 画面全体をキャンバスとする表示でのビューポート境界クランプに使う。
 */
export function clampToRect(p: Point, halfW: number, halfH: number): Point {
  const w = Math.max(0, halfW);
  const h = Math.max(0, halfH);
  return {
    x: Math.max(-w, Math.min(w, p.x)),
    y: Math.max(-h, Math.min(h, p.y)),
  };
}

/**
 * メモ（手描き・テキスト）の基準座標系における外接矩形の中心(cx, cy)と
 * 半幅・半高(halfW, halfH)を返す。
 */
function memoBounds(memo: Memo): { cx: number; cy: number; halfW: number; halfH: number } {
  if (memo.kind === "text") {
    return {
      cx: memo.x,
      cy: memo.y,
      halfW: memo.boxWidth / 2,
      halfH: memo.boxHeight / 2,
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const stroke of memo.strokes) {
    for (const p of stroke) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) {
    return { cx: memo.x, cy: memo.y, halfW: 0, halfH: 0 };
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    halfW: (maxX - minX) / 2,
    halfH: (maxY - minY) / 2,
  };
}

/**
 * ウィンドウサイズに応じた基準スケール（baseScale）に対し、単一のメモ自体が
 * 画面幅・高さを超えるほど大きい場合でも画面内に収まるようスケールを調整する。
 * ウィンドウが再び大きくなればbaseScale側へ戻る。
 */
export function computeResponsiveScale(
  baseScale: number,
  widthPx: number,
  heightPx: number,
  memos: readonly Memo[]
): number {
  if (!(baseScale > 0) || !(widthPx > 0) || !(heightPx > 0)) return baseScale;
  let maxSpanX = 0;
  let maxSpanY = 0;
  let maxLineSpanY = 0;
  for (const memo of memos) {
    if (memo.status !== "active") continue;
    const { halfW, halfH } = memoBounds(memo);
    if (halfW * 2 > maxSpanX) maxSpanX = halfW * 2;
    if (memo.kind === "text" && memo.layout === "line") {
      if (halfH * 2 > maxLineSpanY) maxLineSpanY = halfH * 2;
    } else if (halfH * 2 > maxSpanY) {
      maxSpanY = halfH * 2;
    }
  }
  let scale = baseScale;
  if (maxSpanX > 0) {
    scale = Math.min(scale, (widthPx * 0.92) / maxSpanX);
  }
  if (maxSpanY > 0) {
    scale = Math.min(scale, (heightPx * 0.92) / maxSpanY);
  }
  if (maxLineSpanY > 0) {
    // 行モードの長文で紙全体が極端に縮小されて文字や手描き線が潰れるのを防ぐため、
    // 行テキストの高さによる縮小は基準スケールの半分（170px＝文字サイズ下限相当）を下限にする。
    const minLineScale = Math.min(baseScale, 170);
    scale = Math.min(scale, Math.max(minLineScale, (heightPx * 0.92) / maxLineSpanY));
  }
  return Math.max(40, scale);
}

/**
 * 広いウィンドウで配置されたメモを、より狭いウィンドウ（有効半幅usableHalfW・
 * 有効半高usableHalfH）で表示する際の平行移動オフセット(dx, dy)を返す。
 *
 * - メモ自体の形（手描きの縦横比やテキストの折り返し）は一切歪めず、中心位置だけを
 *   ビューポートの縮小率に合わせて内側へ引き寄せる。
 * - 外接矩形の端がビューポート外へはみ出さないよう[-limitX, limitX]×[-limitY, limitY]へ収める。
 * - ウィンドウを再び広げればratioX/ratioYが1へ戻り、オフセット(0, 0)＝元の広い配置に戻る。
 */
export function computeMemoDisplayOffset(
  memo: Memo,
  usableHalfW: number,
  usableHalfH: number
): Point {
  if (!(usableHalfW > 0) || !(usableHalfH > 0)) return { x: 0, y: 0 };
  const { cx, cy, halfW, halfH } = memoBounds(memo);
  const refW = Math.max(memo.originHalfW ?? 1, Math.abs(cx) + halfW);
  const refH = Math.max(memo.originHalfH ?? 1, Math.abs(cy) + halfH);

  const ratioX = refW > 0 ? Math.min(1, usableHalfW / refW) : 1;
  const ratioY = refH > 0 ? Math.min(1, usableHalfH / refH) : 1;

  const limitX = Math.max(0, usableHalfW - halfW);
  const limitY = Math.max(0, usableHalfH - halfH);

  const targetCx = Math.max(-limitX, Math.min(limitX, cx * ratioX));
  const targetCy = Math.max(-limitY, Math.min(limitY, cy * ratioY));

  const dx = targetCx - cx;
  const dy = targetCy - cy;
  return {
    x: Math.abs(dx) < 1e-9 ? 0 : dx,
    y: Math.abs(dy) < 1e-9 ? 0 : dy,
  };
}
