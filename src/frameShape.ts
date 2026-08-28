import { clampToCircle, clampToEllipse, clampToGlasses, clampToRoundedRect } from "./geometry";
import type { Point } from "./types";

export type FrameShapeId = "round" | "oval" | "square";
export const DEFAULT_FRAME_SHAPE_ID: FrameShapeId = "round";

/**
 * SMUIのレンズ枠形状。外枠の描画・クリップだけでなく、実際に描画できる領域
 * （ポインタ・移動道具のクランプ境界）も、選んだ形状の輪郭そのものに一致させる
 * ——以前は「形状は見た目のスキンで、クランプは常に半径1の円のまま」という
 * 設計だったが、Oval/Squareで円の外側（見た目の枠の内側）に書き込めない領域が
 * 生まれてしまう問題があったため、この形式に変更した（ユーザー指示）。
 *
 * この変更は左レンズ（既存メインの個人MemoStoreと共有）にも及ぶため、SMUIで
 * 円の外側までメモを動かした場合、その位置は「キャンバス」タブ（形状選択が無く
 * 常に円）や、SMUIを丸眼鏡に戻した状態では円の外にはみ出して見える
 * ——正規化座標の意味自体は変えず、クランプ境界（＝今どの形状を見ているか）
 * だけが view 側の状態として変わる、という設計（ユーザー確認済みの
 * 許容トレードオフ）。
 */
export interface FrameShape {
  id: FrameShapeId;
  label: string;
  /** 原点にtranslate済みのctxに対し、外枠描画・クリップの両方に使うPath2Dを組み立てる。
   *  bridgeHalfHeightは眼鏡形状（getGlassesFrameShape）だけが使う、ブリッジの半分の
   *  高さ（scale基準の正規化単位）——省略時はGLASSES_BRIDGE_HALF_HEIGHT_DEFAULTを
   *  使う。round/oval/squareの単一形状は無視する。
   *
   *  offsetは、この輪郭を「一定距離だけ外側にオフセットした」輪郭を作るための
   *  追加の距離（px、scaleと同じ単位）。太い縁取り線を描く際、単純にscale自体を
   *  scale+frameStrokeWidth/2に置き換えて「一様スケール」しただけでは、原点からの
   *  一様スケールが実際の一定距離オフセットと一致しない場所（squareの角、
   *  glassesの接合部の付け根のように直線から曲線へ切り替わる場所）でズレが生じ、
   *  縁取りと内側の紙の間に隙間ができてしまう（ユーザー指摘・実測確認済み）。
   *  offsetは「scaleは据え置き、半径・半辺・ブリッジの高さなど各パーツの
   *  大きさにoffsetを足す」形で実装し、真の一定距離オフセットに近似する。 */
  buildPath(scale: number, bridgeHalfHeight?: number, offset?: number): Path2D;
  /** このシェイプの原点からの最大到達距離（scale基準）。キャンバス余白の計算に使う。 */
  maxReach: number;
  /** y=0（水平線上）での原点からの到達距離（scale基準）。SMUIのブリッジ（レンズを
   *  つなぐ橋）の幅を、実際のレンズの縁の位置に正確に合わせるために使う
   *  （smuiView.ts参照）。Round/SquareはmaxReachと異なり1（横方向にはみ出さない）、
   *  Ovalは横長なのでmaxReachと同じOVAL_RX_FACTOR。 */
  horizontalReach: number;
  /** 正規化座標上の点を、この形状の輪郭の内側に丸め込む（ポインタ入力・移動道具の
   *  ドラッグで使う）。buildPathと同じ輪郭に一致させること。 */
  clamp(p: Point): Point;
}

const round: FrameShape = {
  id: "round",
  label: "丸眼鏡",
  buildPath(scale, _bridgeHalfHeight, offset = 0) {
    const path = new Path2D();
    path.arc(0, 0, scale + offset, 0, Math.PI * 2);
    return path;
  },
  maxReach: 1.0,
  horizontalReach: 1.0,
  clamp(p) {
    return clampToCircle(p, 1);
  },
};

const OVAL_RX_FACTOR = 1.12;

const oval: FrameShape = {
  id: "oval",
  label: "楕円",
  buildPath(scale, _bridgeHalfHeight, offset = 0) {
    const path = new Path2D();
    path.ellipse(0, 0, scale * OVAL_RX_FACTOR + offset, scale + offset, 0, 0, Math.PI * 2);
    return path;
  },
  maxReach: OVAL_RX_FACTOR,
  horizontalReach: OVAL_RX_FACTOR,
  clamp(p) {
    return clampToEllipse(p, OVAL_RX_FACTOR, 1);
  },
};

const SQUARE_CORNER_RADIUS_FACTOR = 0.3;

const square: FrameShape = {
  id: "square",
  label: "長方形",
  buildPath(scale, _bridgeHalfHeight, offset = 0) {
    // half・rの両方にoffsetを足すと、角の中心(half-r)はoffsetに関わらず一定の
    // ままになる——真の一定距離オフセットになる（半径・半辺をscale倍するだけの
    // 一様スケールだと、角では辺よりオフセット量が大きくなってしまう）。
    const half = scale + offset;
    const r = scale * SQUARE_CORNER_RADIUS_FACTOR + offset;
    const path = new Path2D();
    path.roundRect(-half, -half, half * 2, half * 2, r);
    return path;
  },
  // 角丸部分（半径r、中心(half-r, half-r)の四分円）上で原点から最も遠い点までの距離:
  // √2 * (half - r) + r。half=scale, r=0.3*scaleとして ≈ 1.29 * scale。
  maxReach: Math.SQRT2 * (1 - SQUARE_CORNER_RADIUS_FACTOR) + SQUARE_CORNER_RADIUS_FACTOR,
  horizontalReach: 1.0,
  clamp(p) {
    return clampToRoundedRect(p, 1, SQUARE_CORNER_RADIUS_FACTOR);
  },
};

const FRAME_SHAPES: Record<FrameShapeId, FrameShape> = { round, oval, square };

export const FRAME_SHAPE_ORDER: FrameShapeId[] = ["round", "oval", "square"];

export function getFrameShape(id: FrameShapeId): FrameShape {
  return FRAME_SHAPES[id];
}

/**
 * 眼鏡形状（共有キャンバス専用、左右レンズ+ブリッジを1つの連続領域として描く）。
 * FrameShapeIdは増やさず、既存3種類のレンズスタイル（丸眼鏡/楕円/長方形）を
 * そのまま「レンズの形」として再利用する——AppearanceSelectorは変更不要。
 *
 * 左右レンズの中心は原点から±GLASSES_CENTER_OFFSET、ブリッジは高さ
 * ±bridgeHalfHeightの矩形（呼び出し元がframeStrokeWidthから動的に渡す値、
 * buildPath参照）。bridgeHalfHeightはsquareの直線辺（半辺1 -
 * SQUARE_CORNER_RADIUS_FACTOR = 0.7）の内側に収まる値であること——そうしないと
 * ブリッジが角丸部分に接続されてしまう。
 */
export const GLASSES_CENTER_OFFSET = 1.3;
/** ブリッジ（接合部）は書き込める領域には含めず、フレームと同じ太さ・色で
 *  塗りつぶすバーとして見せる（ユーザー指示: 接合部をフレームと同じ太さに）。
 *  実際の高さはCircularCanvasがその時のframeStrokeWidthから動的に計算して
 *  buildPathに渡す（canvasView.ts参照）——この定数は、その値を渡されなかった
 *  場合だけのフォールバック。 */
const GLASSES_BRIDGE_HALF_HEIGHT_DEFAULT = 0.12;
/** 全レンズスタイル共通の縦方向reach（半径・半辺はいずれも1）。 */
export const GLASSES_VERTICAL_REACH = 1.0;

/**
 * 円/楕円レンズ版の眼鏡パス。右レンズ下の接続点→（ブリッジと反対側=外側を
 * 通る長い方の弧）→右レンズ上の接続点→ブリッジ上辺→左レンズ上の接続点→
 * （外側を通る長い方の弧）→左レンズ下の接続点→ブリッジ下辺→閉じる、という
 * 1本の連続したパスとして構築する（3つの部分図形を別々のサブパスとして
 * 重ねるのではなく単一パスにするのは、ctx.stroke()時に不要な縫い目線が
 * 出るのを避けるため）。
 */
function buildGlassesEllipsePath(scale: number, rxFactor: number, bridgeHalfHeight: number, offset = 0): Path2D {
  // レンズ中心(cx)はoffsetに関わらず固定——レンズ自体の半径(rx/ry)とブリッジの
  // 高さ(h)にoffsetを足すことで、真の一定距離オフセットに近似する（単純に
  // scale全体を大きくする一様スケールでは、接合部の付け根でオフセット量が
  // 本来より小さくなり、縁取りと紙の間に隙間ができてしまう——ユーザー指摘・
  // 実測確認済み）。
  const rx = scale * rxFactor + offset;
  const ry = scale + offset;
  const cx = scale * GLASSES_CENTER_OFFSET;
  const h = scale * bridgeHalfHeight + offset;
  const dx = rx * Math.sqrt(1 - (h / ry) ** 2);

  const thetaLowerRight = Math.atan2(-h, -dx);
  const thetaUpperRight = Math.atan2(h, -dx);
  const thetaUpperLeft = Math.atan2(h, dx);
  const thetaLowerLeft = Math.atan2(-h, dx);

  const path = new Path2D();
  path.moveTo(cx - dx, -h);
  path.ellipse(cx, 0, rx, ry, 0, thetaLowerRight, thetaUpperRight, false);
  path.lineTo(-cx + dx, h);
  path.ellipse(-cx, 0, rx, ry, 0, thetaUpperLeft, thetaLowerLeft, false);
  path.lineTo(cx - dx, -h);
  path.closePath();
  return path;
}

/** 長方形レンズ版の眼鏡パス。考え方はbuildGlassesEllipsePathと同じ（1本の
 *  連続パス）。各レンズの角丸部分（ブリッジと反対側の3つの角）を経由する
 *  長い方の経路でつなぎ、ブリッジ側の直線辺の一部だけを橋渡しに使う。 */
function buildGlassesSquarePath(scale: number, bridgeHalfHeight: number, offset = 0): Path2D {
  // half・rの両方にoffsetを足すと角の中心(half-r)はoffsetに関わらず一定になる
  // （square単体のbuildPathと同じ考え方）。レンズ中心(cx)はoffsetに関わらず
  // 固定——ブリッジの高さ(h)にもoffsetを足し、真の一定距離オフセットに近似する。
  const half = scale + offset;
  const r = scale * SQUARE_CORNER_RADIUS_FACTOR + offset;
  const inner = half - r;
  const cx = scale * GLASSES_CENTER_OFFSET;
  const h = scale * bridgeHalfHeight + offset;

  const path = new Path2D();
  // 右レンズ: 下の接続点から、外側の3つの角を経由して上の接続点まで
  path.moveTo(cx - half, -h);
  path.lineTo(cx - half, -inner);
  path.arc(cx - inner, -inner, r, Math.PI, (3 * Math.PI) / 2, false);
  path.lineTo(cx + inner, -half);
  path.arc(cx + inner, -inner, r, (3 * Math.PI) / 2, Math.PI * 2, false);
  path.lineTo(cx + half, inner);
  path.arc(cx + inner, inner, r, 0, Math.PI / 2, false);
  path.lineTo(cx - inner, half);
  path.arc(cx - inner, inner, r, Math.PI / 2, Math.PI, false);
  path.lineTo(cx - half, h);

  // ブリッジ上辺
  path.lineTo(-cx + half, h);

  // 左レンズ: 上の接続点から、外側の3つの角を経由して下の接続点まで
  path.lineTo(-cx + half, inner);
  path.arc(-cx + inner, inner, r, 0, Math.PI / 2, false);
  path.lineTo(-cx - inner, half);
  path.arc(-cx - inner, inner, r, Math.PI / 2, Math.PI, false);
  path.lineTo(-cx - half, -inner);
  path.arc(-cx - inner, -inner, r, Math.PI, (3 * Math.PI) / 2, false);
  path.lineTo(-cx + inner, -half);
  path.arc(-cx + inner, -inner, r, (3 * Math.PI) / 2, Math.PI * 2, false);
  path.lineTo(-cx + half, -h);

  // ブリッジ下辺
  path.lineTo(cx - half, -h);
  path.closePath();
  return path;
}

function clampToGlassesLens(p: Point, lensId: FrameShapeId): Point {
  return clampToGlasses(p, getFrameShape(lensId).clamp, GLASSES_CENTER_OFFSET);
}

/** ブリッジ（塗りつぶしバー）の半幅。レンズごとに輪郭の接続点のx座標
 *  （buildGlassesEllipsePath/buildGlassesSquarePathの接続点と同じ計算）が
 *  異なるため、レンズスタイルごとに個別の式を持つ——正規化単位（scale基準）。
 *  bridgeHalfHeightに応じて変わる（フレームの太さが変わればブリッジの高さも
 *  変わり、それに応じて接続点の位置＝幅も変わるため、固定値ではなく関数にして
 *  ある）。 */
export function glassesBridgeHalfWidth(lensId: FrameShapeId, bridgeHalfHeight: number): number {
  switch (lensId) {
    case "round":
      return GLASSES_CENTER_OFFSET - Math.sqrt(1 - bridgeHalfHeight ** 2);
    case "oval":
      return GLASSES_CENTER_OFFSET - OVAL_RX_FACTOR * Math.sqrt(1 - bridgeHalfHeight ** 2);
    case "square":
      return GLASSES_CENTER_OFFSET - 1;
  }
}

/** レンズ単体のmaxReach/horizontalReachに、レンズ中心の原点からのオフセット
 *  （GLASSES_CENTER_OFFSET）を足しただけの安全な上限値。円・楕円については
 *  実際に原点から最も遠い点（レンズ中心から見て真横=外向きの点）と厳密に一致する
 *  （計算で確認済み）。長方形については実際の最遠点（角の丸め部分）がこれより
 *  わずかに内側になる、安全側の見積もり（square単体のmaxReachが角基準で
 *  控えめな余白を持つのと同じ考え方）。 */
const glassesRound: FrameShape = {
  id: "round",
  label: "丸眼鏡",
  buildPath(scale, bridgeHalfHeight = GLASSES_BRIDGE_HALF_HEIGHT_DEFAULT, offset = 0) {
    return buildGlassesEllipsePath(scale, 1, bridgeHalfHeight, offset);
  },
  maxReach: GLASSES_CENTER_OFFSET + round.maxReach,
  horizontalReach: GLASSES_CENTER_OFFSET + round.horizontalReach,
  clamp(p) {
    return clampToGlassesLens(p, "round");
  },
};

const glassesOval: FrameShape = {
  id: "oval",
  label: "楕円",
  buildPath(scale, bridgeHalfHeight = GLASSES_BRIDGE_HALF_HEIGHT_DEFAULT, offset = 0) {
    return buildGlassesEllipsePath(scale, OVAL_RX_FACTOR, bridgeHalfHeight, offset);
  },
  maxReach: GLASSES_CENTER_OFFSET + oval.maxReach,
  horizontalReach: GLASSES_CENTER_OFFSET + oval.horizontalReach,
  clamp(p) {
    return clampToGlassesLens(p, "oval");
  },
};

const glassesSquare: FrameShape = {
  id: "square",
  label: "長方形",
  buildPath(scale, bridgeHalfHeight = GLASSES_BRIDGE_HALF_HEIGHT_DEFAULT, offset = 0) {
    return buildGlassesSquarePath(scale, bridgeHalfHeight, offset);
  },
  maxReach: GLASSES_CENTER_OFFSET + square.maxReach,
  horizontalReach: GLASSES_CENTER_OFFSET + square.horizontalReach,
  clamp(p) {
    return clampToGlassesLens(p, "square");
  },
};

const GLASSES_SHAPES: Record<FrameShapeId, FrameShape> = {
  round: glassesRound,
  oval: glassesOval,
  square: glassesSquare,
};

export function getGlassesFrameShape(id: FrameShapeId): FrameShape {
  return GLASSES_SHAPES[id];
}

/** 共有キャンバス（眼鏡形状）の横方向reach。全レンズスタイルのうちもっとも
 *  横に張り出す値を基準にコンテナのアスペクト比を決める（canvasView.ts参照）。 */
const GLASSES_MAX_HORIZONTAL_REACH = Math.max(
  ...FRAME_SHAPE_ORDER.map((id) => GLASSES_SHAPES[id].horizontalReach)
);

/** ヒンジ（レンズ外側の水平先端に付く小さな出っ張り）の装飾。正面から見た
 *  実物の眼鏡はつる（テンプル）が奥に折れてほぼ見えないため、つるの線は描かず、
 *  フレームの縁から外側に飛び出す小さな角丸タブだけを残す（ユーザー指摘・
 *  参考イラスト参照）。フレームの縁（縁取りの外側の実際の縁）に内側の端を
 *  ぴったり付け、そこから外側に伸ばす（canvasView.tsのdrawGlassesHinges参照）。
 *
 *  値はブリッジの高さと同じくscale基準（正規化単位）にしてある
 *  ——frameStrokeWidthの倍率にしていた以前の版は、frameStrokeWidthがウィンドウ
 *  サイズに関わらず固定pxだったため、ウィンドウが小さい時にヒンジだけ相対的に
 *  巨大に見えてしまっていた（ユーザー指摘）。scale基準にすることで、ブリッジ・
 *  レンズ本体と同じ比率でウィンドウサイズに追従する。 */
export const GLASSES_HINGE_TAB_LENGTH = 0.16;
export const GLASSES_HINGE_TAB_HALF_HEIGHT = 0.12;
export const GLASSES_HINGE_TAB_RADIUS = 0.06;
/** ヒンジのタブがキャンバス要素の外にクリップされないための、横方向reachの
 *  余白込みの版。共有キャンバスのコンテナサイズ計算（canvasView.tsのresize()）
 *  で使う。GLASSES_HINGE_TAB_LENGTHと同じscale基準の単位なので、そのまま
 *  reachに足すだけでよい（frameStrokeWidthのpx換算が不要になった）。 */
export const GLASSES_HORIZONTAL_REACH_WITH_HINGE = GLASSES_MAX_HORIZONTAL_REACH + GLASSES_HINGE_TAB_LENGTH + 0.05;
