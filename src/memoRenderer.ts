import { fontPxForRender, LINE_HEIGHT_MULTIPLIER, TEXT_FONT_FAMILY } from "./textLayout";
import { isDarkThemeActive, resolveInkColor } from "./theme";
import { toolRenderStyle } from "./toolStyle";
import type { Memo } from "./types";

/**
 * 中心(cx, cy)・半径radiusPxの放射グラデーションの円を描く共通ヘルパー。
 * 移動中のかすかなグロー（canvasView.ts）で使う。
 */
export function drawRadialGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  color: string
): void {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "transparent");
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 1つのメモをローカル座標系（中心が原点、基準1単位がradius px）に描画する。
 * 呼び出し側であらかじめ中心へtranslate済みのコンテキストに対して呼ぶこと。
 * 既定の黒インクはダークモード時に自動で白系インクへ切り替えて視認性を保つ。
 */
export function renderMemoAt(
  ctx: CanvasRenderingContext2D,
  memo: Memo,
  radius: number,
  opacity: number
): void {
  const dark = isDarkThemeActive();
  const resolvedColor = resolveInkColor(memo.color, dark);

  if (memo.kind === "stroke") {
    const style = toolRenderStyle(memo.tool, radius, memo.lineWidth);
    ctx.globalAlpha = opacity * style.alphaMultiplier;
    ctx.globalCompositeOperation = dark && memo.tool === "marker" ? "source-over" : style.composite;
    ctx.strokeStyle = resolvedColor;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of memo.strokes) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x * radius, stroke[0].y * radius);
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i].x * radius, stroke[i].y * radius);
      }
      ctx.stroke();
    }
    return;
  }

  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = resolvedColor;
  const fontPx = fontPxForRender(memo.fontSize, radius);
  ctx.font = `${fontPx}px ${TEXT_FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  const lineHeight = fontPx * (memo.lineHeight ?? LINE_HEIGHT_MULTIPLIER);
  const totalHeight = memo.textLines.length * lineHeight;
  let ly = memo.y * radius - totalHeight / 2 + lineHeight / 2;
  const isLeft = memo.align === "left";
  ctx.textAlign = isLeft ? "left" : "center";
  const lx = isLeft ? (memo.x - memo.boxWidth / 2) * radius : memo.x * radius;
  for (const line of memo.textLines) {
    ctx.fillText(line, lx, ly);
    ly += lineHeight;
  }
}
