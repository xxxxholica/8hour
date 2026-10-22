import { fitCanvasToContainer } from "./canvasSizing";
import { clampToRect, computeResponsiveScale } from "./geometry";
import type { Memo, Point } from "./types";

/** ウィンドウ縮小時にメモを画面内へ引き寄せる際、画面の最外周ピクセルに
 *  ぴったり貼り付かないよう設ける控えめな余白（正規化単位）。 */
const VIEWPORT_PADDING_NORM = 0.04;

/**
 * 画面全体に広がるキャンバスのサイズ・基準スケール・中心座標を管理する。
 * ビューポート全体（width×height）をそのまま描画・配置領域として扱う。
 */
export class FrameGeometry {
  private widthValue = 0;
  private heightValue = 0;
  private baseScaleValue = 0;
  private scaleValue = 0;
  private centerPxValue: Point = { x: 0, y: 0 };

  private canvas: HTMLCanvasElement;
  private container: HTMLElement;
  private dpr: number;

  constructor(canvas: HTMLCanvasElement, container: HTMLElement, dpr: number) {
    this.canvas = canvas;
    this.container = container;
    this.dpr = dpr;
    this.resize();
  }

  get width(): number {
    return this.widthValue;
  }

  get height(): number {
    return this.heightValue;
  }

  get scale(): number {
    return this.scaleValue;
  }

  get centerPx(): Point {
    return this.centerPxValue;
  }

  /** 現在の画面の水平方向の半幅（正規化単位、中心から左右端までの距離）。 */
  get halfExtentX(): number {
    return this.scaleValue > 0 ? this.widthValue / 2 / this.scaleValue : 1;
  }

  /** 現在の画面の垂直方向の半高（正規化単位、中心から上下端までの距離）。 */
  get halfExtentY(): number {
    return this.scaleValue > 0 ? this.heightValue / 2 / this.scaleValue : 1;
  }

  /** ウィンドウ縮小時のメモ位置調整および新規配置で使う有効半幅・半高（正規化単位）。 */
  usableHalfExtents(): { halfW: number; halfH: number } {
    return {
      halfW: Math.max(0.1, this.halfExtentX - VIEWPORT_PADDING_NORM),
      halfH: Math.max(0.1, this.halfExtentY - VIEWPORT_PADDING_NORM),
    };
  }

  /** 画面全体の矩形領域に座標を丸め込むクランプ関数。 */
  viewportClamp(): (p: Point) => Point {
    const hx = this.halfExtentX;
    const hy = this.halfExtentY;
    return (p: Point) => clampToRect(p, hx, hy);
  }

  /** メモ群の大きさに合わせて実効スケールを同期する。単一のメモが画面幅・高さを
   *  超えるほど大きい場合でも、縮小されたウィンドウ内に収まるようスケールを調整する。 */
  syncScaleForMemos(memos: readonly Memo[]): void {
    this.scaleValue = computeResponsiveScale(
      this.baseScaleValue,
      this.widthValue,
      this.heightValue,
      memos
    );
  }

  resize(): void {
    this.canvas.style.width = "0px";
    this.canvas.style.height = "0px";
    const { width, height, scale, centerPx } = fitCanvasToContainer(
      this.canvas,
      this.container,
      this.dpr
    );
    this.widthValue = width;
    this.heightValue = height;
    this.baseScaleValue = scale;
    this.scaleValue = scale;
    this.centerPxValue = centerPx;
  }
}
