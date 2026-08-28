import type { Point, Stroke } from "./types";

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

/** 円（原点中心・半径 radius）の内側に点を丸め込む。 */
export function clampToCircle(p: Point, radius: number): Point {
  const d = Math.hypot(p.x, p.y);
  if (d <= radius) return p;
  const scale = radius / d;
  return { x: p.x * scale, y: p.y * scale };
}

export function isInsideCircle(p: Point, radius: number): boolean {
  return p.x * p.x + p.y * p.y <= radius * radius;
}

/**
 * pがclampの境界の内側にあるか。clamp系の関数（clampToCircle等）は境界の内側の点を
 * 値そのまま返す実装になっているため、clamp(p)とpを値比較するだけで内外判定できる
 * （restrictTranslation・clampToGlassesの内側判定と同じイディオム）。
 */
export function isInsideClamp(p: Point, clamp: (p: Point) => Point): boolean {
  const clamped = clamp(p);
  return clamped.x === p.x && clamped.y === p.y;
}

/**
 * 楕円（原点中心・半径rx,ry）の内側に点を丸め込む。原点からpへの向きはそのまま
 * 保ち、その方向の楕円境界までの距離に縮める（clampToCircleのrx=ry=radius版と
 * 同じ考え方の一般化）。
 */
export function clampToEllipse(p: Point, rx: number, ry: number): Point {
  const norm = (p.x * p.x) / (rx * rx) + (p.y * p.y) / (ry * ry);
  if (norm <= 1) return p;
  const scale = 1 / Math.sqrt(norm);
  return { x: p.x * scale, y: p.y * scale };
}

/**
 * 角丸長方形（原点中心、半辺half、角丸半径cornerRadius）の内側に点を丸め込む。
 * 直線の辺に近い（=角の丸め部分の外にある）点は軸ごとに素直にクランプし、
 * 角の丸め部分にある点はその角の中心（各辺からcornerRadiusだけ内側）からの
 * 距離をcornerRadiusに縮める。
 */
export function clampToRoundedRect(p: Point, half: number, cornerRadius: number): Point {
  const inner = half - cornerRadius;
  const ax = Math.abs(p.x);
  const ay = Math.abs(p.y);
  if (ax <= inner || ay <= inner) {
    return {
      x: Math.max(-half, Math.min(half, p.x)),
      y: Math.max(-half, Math.min(half, p.y)),
    };
  }
  const cx = Math.sign(p.x) * inner;
  const cy = Math.sign(p.y) * inner;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d = Math.hypot(dx, dy);
  if (d <= cornerRadius) return p;
  const scale = cornerRadius / d;
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * 眼鏡形状（左右レンズ+ブリッジ、見た目は非凸な1つの輪郭）の内側に点を丸め込む。
 * ブリッジ部分は見た目には連続した1つの輪郭の一部だが、書き込める領域としては
 * 意図的に含めない——左右レンズのどちらかの内側ならpをそのまま返し、それ以外
 * （ブリッジの隙間も含む）は常に近い方のレンズの境界に丸め込む（ユーザー指示：
 * 接合部には書き込めないようにする）。lensClampは単一レンズ（原点中心の
 * ローカル座標）向けのclamp（clampToCircle/clampToEllipse/clampToRoundedRect
 * のいずれか）。centerOffsetは左右レンズ中心の原点からのX距離（正規化単位）。
 */
export function clampToGlasses(p: Point, lensClamp: (local: Point) => Point, centerOffset: number): Point {
  const rightLocal: Point = { x: p.x - centerOffset, y: p.y };
  const leftLocal: Point = { x: p.x + centerOffset, y: p.y };
  const rightClamped = lensClamp(rightLocal);
  const leftClamped = lensClamp(leftLocal);
  const insideRight = rightClamped.x === rightLocal.x && rightClamped.y === rightLocal.y;
  const insideLeft = leftClamped.x === leftLocal.x && leftClamped.y === leftLocal.y;
  if (insideRight || insideLeft) return p;

  const candRight: Point = { x: rightClamped.x + centerOffset, y: rightClamped.y };
  const candLeft: Point = { x: leftClamped.x - centerOffset, y: leftClamped.y };
  return distance(p, candRight) <= distance(p, candLeft) ? candRight : candLeft;
}

/**
 * 単一レンズclamp（clampToCircle/clampToEllipse/clampToRoundedRectのいずれか、
 * 原点中心のローカル座標前提）を、指定したcenterへ平行移動して適用する。
 * clampToGlassesと違い「近い方のレンズを選ぶ」判定はしない——呼び出し側で
 * 自分の担当レンズが既に一意に決まっている場合に使う（SMUIのレンズ分割表示、
 * 自分の書き込みを自分のレンズ領域だけに制限する用途）。
 */
export function clampToOffsetLens(p: Point, lensClamp: (local: Point) => Point, center: Point): Point {
  const local: Point = { x: p.x - center.x, y: p.y - center.y };
  const clampedLocal = lensClamp(local);
  return { x: clampedLocal.x + center.x, y: clampedLocal.y + center.y };
}

/**
 * clampToGlassesの「近い方を選ぶ」判定を、左右2箇所限定から任意個のレンズへ
 * 一般化したもの。レンズ分割(issue #79)で複数組(眼鏡ペア)が横に並ぶ間、
 * 「自分のレンズに限定せず、いずれかのレンズの範囲内なら許可する」用途に使う
 * （discussion中のマスターの書き込み・voting/resultsの投票・表示、issue
 * #114/#119対応）。lensesは各レンズの中心(center、正規化単位のグローバル座標)と
 * その組の形状に対応するclamp(原点中心のローカル座標前提)の組。
 */
export function clampToAnyOffsetLens(p: Point, lenses: { center: Point; clamp: (local: Point) => Point }[]): Point {
  let nearest: Point | null = null;
  let nearestDist = Infinity;
  for (const { center, clamp } of lenses) {
    const local: Point = { x: p.x - center.x, y: p.y - center.y };
    const clampedLocal = clamp(local);
    if (clampedLocal.x === local.x && clampedLocal.y === local.y) return p;
    const candidate: Point = { x: clampedLocal.x + center.x, y: clampedLocal.y + center.y };
    const d = distance(p, candidate);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = candidate;
    }
  }
  return nearest ?? p;
}

/**
 * 点群（ストロークを構成する全ての点）を (dx, dy) だけ剛体移動しようとしたとき、
 * 移動後に境界の外へ出る点が1つでもあれば、全ての点が境界内に収まる範囲まで
 * 移動量を比例的に縮める（2分探索）。個々の点を境界へ独立にスナップする
 * （clampToCircle等をmapで適用する）方式は、境界に近い点ほど個別に丸め込まれて
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

  const isInside = (p: Point): boolean => {
    const clamped = clamp(p);
    return clamped.x === p.x && clamped.y === p.y;
  };
  const fits = (t: number): boolean =>
    points.every((p) => isInside({ x: p.x + dx * t, y: p.y + dy * t }));

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

/**
 * 矩形（半径halfW×halfHの箱）を境界内に置けるよう、中心点desiredを調整する。
 * テキストメモを新規に置く瞬間（タップした場所の直後）に使う——タップ位置
 * そのものを箱の中心にすると、境界に近い場所をタップした場合に箱の端が
 * はみ出してしまう（ユーザー指摘：移動時のはみ出しをtranslateMemoで直したのと
 * 同じ問題が、最初に置く瞬間にも起こる）。
 * 原点(0,0)を中心にした箱を「原点からdesiredへ」動かす移動として捉え、
 * restrictTranslationに任せる（原点中心の箱は大抵境界に収まるため、境界に
 * 収まる範囲でdesiredにできるだけ近づける、という挙動になる）。原点に置いても
 * 箱が境界に収まりきらないほど大きい場合（レアケース）は、restrictTranslationが
 * 移動量0を返すため、そのまま原点を返す。
 */
export function clampBoxCenter(
  desired: Point,
  halfWidth: number,
  halfHeight: number,
  clamp: (p: Point) => Point
): Point {
  const cornersAtOrigin: Point[] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: -halfWidth, y: halfHeight },
    { x: halfWidth, y: halfHeight },
  ];
  const { dx, dy } = restrictTranslation(cornersAtOrigin, desired.x, desired.y, clamp);
  return { x: dx, y: dy };
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
