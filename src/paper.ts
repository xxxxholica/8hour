import { isDarkThemeActive } from "./theme";

/**
 * 無地の紙面背景。中心を原点にtranslate済みのコンテキストに対して呼ぶ。
 * ライトモード時は真っ白（#ffffff）、ダークモード時は暗い紙色で画面全体を塗る。
 */

const PAPER_LIGHT = "#f2ede6";
const PAPER_DARK = "oklch(26% 0.006 75)";

/**
 * @param radius 基準スケール（互換のため受け取る）。
 * @param fillHalfWidth 紙面を塗り広げる水平方向の半幅（省略時はradiusと同じ）。
 * @param fillHalfHeight 紙面を塗り広げる垂直方向の半高（省略時はfillHalfWidthと同じ）。
 */
export function drawRuledPaper(
  ctx: CanvasRenderingContext2D,
  radius: number,
  fillHalfWidth: number = radius,
  fillHalfHeight: number = fillHalfWidth
): void {
  if (
    !(radius > 0) ||
    !(fillHalfWidth > 0) ||
    !(fillHalfHeight > 0) ||
    !Number.isFinite(radius) ||
    !Number.isFinite(fillHalfWidth) ||
    !Number.isFinite(fillHalfHeight)
  ) {
    return;
  }

  const dark = isDarkThemeActive();
  ctx.fillStyle = dark ? PAPER_DARK : PAPER_LIGHT;
  ctx.fillRect(-fillHalfWidth, -fillHalfHeight, fillHalfWidth * 2, fillHalfHeight * 2);
}
