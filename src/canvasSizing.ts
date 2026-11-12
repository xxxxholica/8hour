import { REFERENCE_RADIUS } from "./toolStyle";
import type { Point } from "./types";

/** キャンバスの一辺（px）の下限。極端に小さいウィンドウでも破綻しないようにする。 */
const MIN_CANVAS_SIZE = 200;

interface CanvasGeometry {
  width: number;
  height: number;
  /** px per 正規化単位（基準1単位あたりの論理px）。 */
  scale: number;
  centerPx: Point;
}

/**
 * コンテナの利用可能な幅・高さを、正方形に制限せずそのまま返す（下限だけ
 * MIN_CANVAS_SIZEで保証し、極端に狭いレイアウトでの退化を防ぐ）。
 */
function computeContainerSize(
  container: HTMLElement,
  minSize: number = MIN_CANVAS_SIZE
): { width: number; height: number } {
  const rect = container.getBoundingClientRect();
  const width = Math.max(minSize, rect.width);
  const height = Math.max(minSize, rect.height || rect.width);
  return { width, height };
}

/**
 * コンテナ全体の幅・高さにキャンバスを合わせ、基準スケールを返す。
 * ウィンドウサイズに関わらず一定の論理px（REFERENCE_RADIUS = 340px）を1単位とする。
 */
export function fitCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  dpr: number
): CanvasGeometry {
  const { width, height } = computeContainerSize(container);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  return {
    width,
    height,
    scale: REFERENCE_RADIUS,
    centerPx: { x: width / 2, y: height / 2 },
  };
}
