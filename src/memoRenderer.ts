import { CANVAS_FRAME_SHAPE } from "./frameShape";
import { drawRuledPaper } from "./paper";
import { fontPxForRender, LINE_HEIGHT_MULTIPLIER, TEXT_FONT_FAMILY } from "./textLayout";
import { toolRenderStyle } from "./toolStyle";
import type { Memo } from "./types";

/**
 * 中心(cx, cy)・半径radiusPxの放射グラデーションの円を描く共通ヘルパー。
 * なぞり中/移動中のかすかなグロー（canvasView.ts）で使う。
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
 * 1つのメモを円のローカル座標系（中心が原点、半径がradius px）に描画する。
 * 呼び出し側であらかじめ円の中心へtranslate済みのコンテキストに対して呼ぶこと。
 * 手描き(stroke)とテキスト(text)の両方に対応し、メインキャンバス・振り返りの
 * タイムラインプレビューの両方から共通で使う（見た目を一致させるため）。
 */
export function renderMemoAt(
  ctx: CanvasRenderingContext2D,
  memo: Memo,
  radius: number,
  opacity: number,
  minTextFontPx?: number
): void {
  if (memo.kind === "stroke") {
    const style = toolRenderStyle(memo.tool, radius, memo.lineWidth);
    ctx.globalAlpha = opacity * style.alphaMultiplier;
    ctx.globalCompositeOperation = style.composite;
    ctx.strokeStyle = memo.color;
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
  ctx.fillStyle = memo.color;
  const fontPx = Math.max(fontPxForRender(memo.fontSize, radius), minTextFontPx ?? 0);
  ctx.font = `${fontPx}px ${TEXT_FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  const lineHeight = fontPx * (memo.lineHeight ?? LINE_HEIGHT_MULTIPLIER);
  const totalHeight = memo.textLines.length * lineHeight;
  let ly = memo.y * radius - totalHeight / 2 + lineHeight / 2;
  // 持ち物チェックのテンプレートのように行ごとに幅が違う文面は、中央揃えだと左端がガタつくため
  // 左揃えにできる（align省略時・既存データは中央揃えのまま）。
  const isLeft = memo.align === "left";
  ctx.textAlign = isLeft ? "left" : "center";
  const lx = isLeft ? (memo.x - memo.boxWidth / 2) * radius : memo.x * radius;
  for (const line of memo.textLines) {
    ctx.fillText(line, lx, ly);
    ly += lineHeight;
  }
}

/**
 * メモの一覧（1日分のアーカイブ等）を、本体キャンバスと同じ角丸正方形
 * （CANVAS_FRAME_SHAPE）に収めた正方形のサムネイルとしてcanvasへ描く。
 * ラスター画像は一切保持していないため、保存済みのベクターデータ（正規化座標の
 * ストローク・テキスト）をrenderMemoAtでそのままsizePxへ再描画する——保存側の
 * 解像度に縛られず劣化なく任意の大きさで描ける。記録一覧画面（recordGrid.ts）
 * のグリッドと、道具バーの独立トリガー（toolbar.ts）のミニアイコンの両方から
 * 共通で使う。
 * withRuledPaperは背景に本体キャンバスと同じ罫線入りの紙（drawRuledPaper）を
 * 敷くかどうか——道具バーの極小トリガー（26px）ではこの大きさだと罫線が潰れて
 * 見えるだけなので既定でfalse（白背景のみ）、記録一覧画面のグリッドセルでは
 * ダミーセル（罫線入りの紙＋曜日バッジ）と見た目を揃えるためtrueを渡す。
 */
export function renderMemoThumbnail(
  canvas: HTMLCanvasElement,
  memos: readonly Memo[],
  sizePx: number,
  withRuledPaper = false
): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = sizePx * dpr;
  canvas.height = sizePx * dpr;
  canvas.style.width = `${sizePx}px`;
  canvas.style.height = `${sizePx}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // メモの座標は「キャンバスの半辺を1とする正規化座標」（types.ts参照）のため、
  // radius（半辺のpx）はサムネイルの半分の一辺にそのまま一致する。
  const half = sizePx / 2;
  ctx.save();
  ctx.translate(half, half);
  ctx.clip(CANVAS_FRAME_SHAPE.buildPath(half));
  if (withRuledPaper) {
    drawRuledPaper(ctx, half);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-half, -half, sizePx, sizePx);
  }
  for (const memo of memos) {
    if (memo.status !== "active") continue;
    renderMemoAt(ctx, memo, half, 1);
  }
  ctx.restore();
}
