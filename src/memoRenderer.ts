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
 * 高さrowHeightの1行の中で、文字を描くときの基準線とその位置（行の上端からの距離）。
 * 編集中の<textarea>（DOMの行ボックス：行の高さの中で、フォントの上端・下端
 * （ascent/descent）の合計を上下に均等な余白で挟んで配置する）と、確定後のcanvas描画の
 * 文字の縦位置を一致させるために、canvasの"middle"（文字の枠の中央）ではなくDOMと
 * 同じ計算で基準線(alphabetic)を決める。以前は"middle"で描いていたため、編集を
 * 終えた瞬間に文字が約1px上へずれて見えた（ユーザー報告）。ctx.fontを設定済みの
 * コンテキストに対して呼ぶ。fontBoundingBoxが使えない環境では従来の"middle"。
 */
export function rowTextBaseline(
  ctx: CanvasRenderingContext2D,
  rowHeight: number
): { baseline: CanvasTextBaseline; offset: number } {
  const m = ctx.measureText("あ");
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  if (typeof ascent === "number" && typeof descent === "number") {
    return { baseline: "alphabetic", offset: (rowHeight - (ascent + descent)) / 2 + ascent };
  }
  return { baseline: "middle", offset: rowHeight / 2 };
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
  const lineHeight = fontPx * (memo.lineHeight ?? LINE_HEIGHT_MULTIPLIER);
  const totalHeight = memo.textLines.length * lineHeight;
  const rowBaseline = rowTextBaseline(ctx, lineHeight);
  ctx.textBaseline = rowBaseline.baseline;
  const topY = memo.layout === "line" ? (memo.y - memo.boxHeight / 2) * radius : memo.y * radius - totalHeight / 2;
  let ly = topY + rowBaseline.offset;
  const isLeft = memo.align === "left";
  ctx.textAlign = isLeft ? "left" : "center";
  const lx = isLeft ? (memo.x - memo.boxWidth / 2) * radius : memo.x * radius;
  for (const line of memo.textLines) {
    ctx.fillText(line, lx, ly);
    ly += lineHeight;
  }
}
