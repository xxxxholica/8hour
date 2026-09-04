import { REFERENCE_RADIUS } from "./toolStyle";

/** テキストに使うフォント。手描きの世界観に合わせ、他の文字と同じ書体にする。 */
export const TEXT_FONT_FAMILY = "'Klee One', 'Noto Sans JP', sans-serif";

/** 折り返し幅の既定値（基準円=半径340pxでのpx値）。テキストメモの正規化boxWidthは
 *  これをREFERENCE_RADIUSで割った値になる。テンプレート（持ち物チェック等、
 *  固定レイアウトの複数行）はこの固定幅のまま使う。通常のテキスト入力
 *  （タップ開始・キーボードでの直接入力どちらも）は、この値に固定せず実際の
 *  内容に応じて可変幅にする（下記measureTextBoxWidthPx参照）——固定幅だと、
 *  短い一言でも余白だらけの大きな箱になったり、逆に長い文が狭すぎてすぐ
 *  折り返されたりして書きにくかった（ユーザー指摘）。 */
export const REFERENCE_TEXT_BOX_WIDTH_PX = 240;

/** 可変幅テキストボックスの下限（基準円でのpx値）。短い一言でも極端に細く
 *  ならないようにする最小幅。 */
const MIN_TEXT_BOX_WIDTH_PX = 140;

/** 可変幅テキストボックスの上限（基準円でのpx値）。ここを超える長さの行は
 *  折り返す——上限なしにすると、円が一番広い高さ以外では形状からはみ出す
 *  マスしか見つからなくなってしまう（実機で再現：中心以外のほぼ全域で空きが
 *  見つからず、すべての入力が同じ場所に重なった）ため、はみ出しを許容しつつも
 *  現実的な範囲に収める。 */
const MAX_TEXT_BOX_WIDTH_PX = 480;

/** 行の高さ（フォントサイズに対する倍率）。 */
export const LINE_HEIGHT_MULTIPLIER = 1.4;

/**
 * 実際に描画するフォントサイズ(px)の下限。円がどれだけ小さいウィンドウで
 * 表示されていても、あるいはユーザーが「小」を選んでいても、これより
 * 小さくは描画しない（読めなくなることを防ぐための下限設定）。
 */
export const MIN_FONT_PX = 12;

/** 文字サイズの選択肢。値は基準円(半径340px)におけるフォントサイズ(px)。 */
export const FONT_SIZE_STEPS = { small: 18, medium: 24, large: 32 } as const;
type FontSizeStep = keyof typeof FONT_SIZE_STEPS;
export const DEFAULT_FONT_SIZE_STEP: FontSizeStep = "medium";

/**
 * 実際の描画半径に応じたフォントサイズ(px)を計算する。線の太さ(toolStyle.ts)と
 * 同じ考え方で、基準円に対する比率でスケールしつつ、下限(MIN_FONT_PX)を必ず守る。
 */
export function fontPxForRender(fontPxAtReference: number, radius: number): number {
  return Math.max(MIN_FONT_PX, fontPxAtReference * (radius / REFERENCE_RADIUS));
}

function wrapParagraphs(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (para === "") {
      lines.push("");
      continue;
    }
    // 日本語には単語間のスペースがないため、1文字ずつ詰めて幅で折り返す
    // （英単語の途中で折り返される場合があるが、手書きメモの短い文章という
    //   用途では厳密なタイポグラフィよりも実装のシンプルさを優先した）。
    let current = "";
    for (const ch of para) {
      const test = current + ch;
      if (current !== "" && ctx.measureText(test).width > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current = test;
      }
    }
    if (current !== "") lines.push(current);
  }
  return lines;
}

/**
 * テキストを、基準円(半径REFERENCE_RADIUS)における折り返し幅(maxWidthPx、既定は
 * REFERENCE_TEXT_BOX_WIDTH_PX＝テンプレート用の固定幅)で行分割する。実際の描画半径や
 * ユーザーが選んだ文字サイズに関わらず、常にこの基準サイズで測定することで、
 * リサイズしても行分割の結果（＝改行位置）が変わらないようにする（フォントサイズも
 * 折り返し幅も同じ比率で実際の半径にスケールするため、基準サイズでの折り返し結果は
 * どの半径でもそのまま正しく使い回せる）。通常のテキスト入力は、測定した実際の幅
 * （measureTextBoxWidthPx参照）をmaxWidthPxとして渡すことで、編集中に見えていた
 * 折り返しと確定後の描画が一致するようにする。
 */
export function wrapTextAtReferenceScale(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontPxAtReference: number,
  maxWidthPx: number = REFERENCE_TEXT_BOX_WIDTH_PX
): string[] {
  const prevFont = ctx.font;
  ctx.font = `${fontPxAtReference}px ${TEXT_FONT_FAMILY}`;
  const lines = wrapParagraphs(ctx, text, maxWidthPx);
  ctx.font = prevFont;
  return lines.length > 0 ? lines : [""];
}

/** テキストブロックの折り返し幅・高さを、円の半径を1とする正規化単位で返す。
 *  boxWidthPxは既定でREFERENCE_TEXT_BOX_WIDTH_PX（テンプレート用の固定幅）。
 *  lineHeightMultiplierは既定でLINE_HEIGHT_MULTIPLIER——テンプレートを置く
 *  瞬間だけTEMPLATE_LINE_HEIGHT_MULTIPLIERを渡す（memo.lineHeightとして
 *  そのまま保存され、renderMemoAt・編集時の再計算の両方で使われる）。 */
export function normalizedBoxSize(
  fontPxAtReference: number,
  lineCount: number,
  boxWidthPx: number = REFERENCE_TEXT_BOX_WIDTH_PX,
  lineHeightMultiplier: number = LINE_HEIGHT_MULTIPLIER
): { width: number; height: number } {
  const width = boxWidthPx / REFERENCE_RADIUS;
  const lineHeightPx = fontPxAtReference * lineHeightMultiplier;
  const height = (lineCount * lineHeightPx) / REFERENCE_RADIUS;
  return { width, height };
}

/**
 * 実際に打たれた内容に合わせて、基準円でのテキストボックス幅(px)を測る（可変幅）。
 * 一番長い行の幅に左右の余白ぶんを足し、MIN〜MAX_TEXT_BOX_WIDTH_PXの範囲に収める。
 * ここで測った幅をそのままwrapTextAtReferenceScale/normalizedBoxSizeのmaxWidthPx/
 * boxWidthPxに渡すことで、編集中の見た目（textareaの実際の幅）と確定後の描画
 * （折り返し・boxWidth）を一致させる。
 */
export function measureTextBoxWidthPx(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontPxAtReference: number
): number {
  const prevFont = ctx.font;
  ctx.font = `${fontPxAtReference}px ${TEXT_FONT_FAMILY}`;
  let maxLineWidth = 0;
  for (const line of text.split("\n")) {
    maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width);
  }
  ctx.font = prevFont;
  // 左右の余白: text-editor-overlayのpadding(4px 6px)+border(1px)ぶんに加え、
  // カーソルが行末に来ても窮屈にならないよう半文字ぶん多めに取る。
  const padding = fontPxAtReference * 0.6 + 14;
  return Math.min(MAX_TEXT_BOX_WIDTH_PX, Math.max(MIN_TEXT_BOX_WIDTH_PX, maxLineWidth + padding));
}
