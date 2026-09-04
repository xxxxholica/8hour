import { clampToRoundedRect } from "./geometry";
import type { Point } from "./types";

/**
 * キャンバスの枠形状（正方形・角丸）。外枠の描画・クリップだけでなく、実際に
 * 描画できる領域（ポインタ・移動道具のクランプ境界）も、この輪郭そのものに
 * 一致させる。
 */
export interface FrameShape {
  /** 原点にtranslate済みのctxに対し、外枠描画・クリップの両方に使うPath2Dを組み立てる。
   *
   *  offsetは、この輪郭を「一定距離だけ外側にオフセットした」輪郭を作るための
   *  追加の距離（px、scaleと同じ単位）。太い縁取り線を描く際、単純にscale自体を
   *  scale+frameStrokeWidth/2に置き換えて「一様スケール」しただけでは、原点からの
   *  一様スケールが実際の一定距離オフセットと一致しない場所（角のように直線から
   *  曲線へ切り替わる場所）でズレが生じ、縁取りと内側の紙の間に隙間が
   *  できてしまう（ユーザー指摘・実測確認済み）。offsetは「scaleは据え置き、
   *  半辺・角の半径にoffsetを足す」形で実装し、真の一定距離オフセットに近似する。 */
  buildPath(scale: number, offset?: number): Path2D;
  /** このシェイプの原点からの最大到達距離（scale基準、角）。キャンバス余白の計算に使う。 */
  maxReach: number;
  /** y=0（水平線上）での原点からの到達距離（scale基準）。正方形は角までの
   *  maxReachと異なり1（横方向にはみ出さない、辺の中点まで）。 */
  horizontalReach: number;
  /** 正規化座標上の点を、この形状の輪郭の内側に丸め込む（ポインタ入力・移動道具の
   *  ドラッグで使う）。buildPathと同じ輪郭に一致させること。 */
  clamp(p: Point): Point;
}

/** 角丸の半径（scale=1を半辺とする正規化単位）。「過去の記録」ウィンドウ
 *  （recordGrid.ts、本体キャンバスと丸みを揃えている）と並べて見た目を
 *  比較した結果、0.3（一辺に対して15%）は両方とも風船のように丸すぎたため
 *  （ユーザー指摘）、0.2（一辺に対して10%）まで下げて一段階シャープにした。 */
const CANVAS_CORNER_RADIUS_FACTOR = 0.2;

export const CANVAS_FRAME_SHAPE: FrameShape = {
  buildPath(scale, offset = 0) {
    // half・rの両方にoffsetを足すと、角の中心(half-r)はoffsetに関わらず一定の
    // ままになる——真の一定距離オフセットになる（半径・半辺をscale倍するだけの
    // 一様スケールだと、角では辺よりオフセット量が大きくなってしまう）。
    const half = scale + offset;
    const r = scale * CANVAS_CORNER_RADIUS_FACTOR + offset;
    const path = new Path2D();
    path.roundRect(-half, -half, half * 2, half * 2, r);
    return path;
  },
  // 角丸部分（半径r、中心(half-r, half-r)の四分円）上で原点から最も遠い点までの距離:
  // √2 * (half - r) + r。half=scale, r=0.3*scaleとして ≈ 1.29 * scale。
  maxReach: Math.SQRT2 * (1 - CANVAS_CORNER_RADIUS_FACTOR) + CANVAS_CORNER_RADIUS_FACTOR,
  horizontalReach: 1.0,
  clamp(p) {
    return clampToRoundedRect(p, 1, CANVAS_CORNER_RADIUS_FACTOR);
  },
};
