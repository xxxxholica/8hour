import type { DrawTool } from "./types";

interface ToolRenderStyle {
  lineWidth: number;
  /** フェードで決まる不透明度に、さらに掛け合わせる質感由来の係数 */
  alphaMultiplier: number;
  composite: GlobalCompositeOperation;
}

/** 太さ・文字サイズの基準値を決めている円の半径(px)。メインキャンバスの中庸なサイズを基準にした値。
 *  textLayout.tsのフォントサイズ・折り返し幅もこの値を基準にしており、
 *  線の太さと文字の大きさの相対的なスケール感を統一している。 */
export const REFERENCE_RADIUS = 340;

/** ペンの太さ（基準円=半径340pxでのpx値、固定・調整不可）。以前はGoodNotesの
 *  ようにバーで連続的に選べるようにしていたが、「メインのターゲット層はPCを
 *  使う人で、ペン（マウス操作）で文字を書くのは難しく、太さも都度選ぶ必要が
 *  薄いので、固定にして見た目をスッキリさせたい」というユーザー指示により
 *  固定値にした（マーカーのMARKER_LINE_WIDTHと同じ考え方）。当初は元の
 *  スライダーの初期値（3px）を踏襲していたが、「もう少し太くしてほしい」
 *  という指摘を受け4pxへ調整した。 */
export const PEN_LINE_WIDTH = 4;

/** マーカーの太さ（基準円=半径340pxでのpx値、固定・調整不可）。以前は15pxで
 *  実際の画面上では太すぎるとの指摘（体感で約6px相当）があったため、体感で
 *  4〜5px程度になるよう約3分の2の11pxへ縮小した（ユーザー指示）。 */
const MARKER_LINE_WIDTH = 11;

function baseStyle(tool: DrawTool, penLineWidth: number): ToolRenderStyle {
  switch (tool) {
    case "marker":
      return { lineWidth: MARKER_LINE_WIDTH, alphaMultiplier: 0.4, composite: "multiply" };
    case "pen":
    default:
      return { lineWidth: penLineWidth, alphaMultiplier: 1, composite: "source-over" };
  }
}

/**
 * ツールごとの見た目（太さ・不透明度の質感・合成方法）。
 * ペン＝標準（太さはpenLineWidthAtReferenceで指定、現在は常にPEN_LINE_WIDTH
 * 固定）、マーカー＝太く半透明で下地と重なるように乗算合成する。
 * radiusを渡すと、その円の大きさに比例して線の太さをスケールする
 * （メインキャンバスと、振り返りのサムネイル／タイムラインプレビューのように
 * サイズが大きく異なる場所で、線の相対的な太さの見た目を揃えるため）。
 * penLineWidthAtReferenceは、そのペンのストロークが作られた時点で選ばれていた
 * 太さ（StrokeMemo.lineWidth）を渡す想定——太さがまだ可変だった頃に作られた
 * 既存ストロークは、当時のlineWidthのまま描画され続ける。省略時（旧バージョンの
 * データなど）はPEN_LINE_WIDTH相当にフォールバックする。マーカーには使わない。
 */
export function toolRenderStyle(
  tool: DrawTool,
  radius: number = REFERENCE_RADIUS,
  penLineWidthAtReference: number = PEN_LINE_WIDTH
): ToolRenderStyle {
  const base = baseStyle(tool, penLineWidthAtReference);
  const scale = radius / REFERENCE_RADIUS;
  return { ...base, lineWidth: Math.max(1, base.lineWidth * scale) };
}
