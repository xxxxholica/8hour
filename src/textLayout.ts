import { REFERENCE_RADIUS } from "./toolStyle";

/** テキストに使うフォント。手描きの世界観に合わせ、他の文字と同じ書体にする。 */
export const TEXT_FONT_FAMILY = "'Klee One', 'Noto Sans JP', sans-serif";

/** 折り返し幅の既定値（基準円=半径340pxでのpx値）。テキストメモの正規化boxWidthは
 *  これをREFERENCE_RADIUSで割った値になる。テンプレート（持ち物チェック等、
 *  固定レイアウトの複数行）はこの固定幅のまま使う。通常のテキスト入力
 *  （タップ開始・キーボードでの直接入力どちらも）は、この値に固定せず実際の
 *  内容に応じて可変幅にする（下記layoutText参照）——固定幅だと、
 *  短い一言でも余白だらけの大きな箱になったり、逆に長い文が狭すぎてすぐ
 *  折り返されたりして書きにくかった（ユーザー指摘）。 */
export const REFERENCE_TEXT_BOX_WIDTH_PX = 240;

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
 * どの半径でもそのまま正しく使い回せる）。通常のテキスト入力は、この関数ではなく
 * layoutText（紙の幅いっぱいまで折り返さない）で行分割する。
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
 * 確定時のレイアウト。内容の幅がmaxContentWidthPx以内なら折り返さず、超える行
 * だけを折り返す（基準円スケール）。contentWidthPxは折り返し後の最長行の幅。
 * 上限幅は固定値ではなく、呼び出し側が「書き込み領域の右端までの幅」から計算して
 * 渡す（canvasView.openTextEditor参照）。以前は固定の480px（24pxの全角で約20文字）が
 * 上限で、それを超える行は意図せず自動で折り返されていた（ユーザー報告）。
 */
export function layoutText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontPxAtReference: number,
  maxContentWidthPx: number
): { lines: string[]; contentWidthPx: number } {
  const prevFont = ctx.font;
  ctx.font = `${fontPxAtReference}px ${TEXT_FONT_FAMILY}`;
  const wrapped = wrapParagraphs(ctx, text, maxContentWidthPx);
  const lines = wrapped.length > 0 ? wrapped : [""];
  let contentWidthPx = 0;
  for (const line of lines) {
    contentWidthPx = Math.max(contentWidthPx, ctx.measureText(line).width);
  }
  ctx.font = prevFont;
  return { lines, contentWidthPx };
}

/* --- 行モード（TextMemo.layout === "line"）の行グリッド ---
   縦位置は「行の上端」がpitch（行の高さ、正規化単位）の整数倍に揃う。行kは
   y ∈ [k*pitch, (k+1)*pitch]で、ガイド罫（canvasView.render）はその境界に引く。 */

/** 行グリッドの1行の高さ（円の半径を1とする正規化単位）。 */
export function lineRowPitch(fontPxAtReference: number, lineHeightMultiplier: number = LINE_HEIGHT_MULTIPLIER): number {
  return (fontPxAtReference * lineHeightMultiplier) / REFERENCE_RADIUS;
}

/** タップしたy（正規化）を含む行の上端へ揃える。 */
export function snapToRowTop(y: number, pitch: number): number {
  return Math.floor(y / pitch) * pitch;
}

/** ブロックの上端topを、高さheightのブロックが[areaTop, areaBottom]に収まる範囲へ
 *  寄せる。すでに収まっていれば動かさない。寄せるときは行グリッド上の位置にする。 */
export function clampRowTop(top: number, height: number, pitch: number, areaTop: number, areaBottom: number): number {
  const minTop = areaTop;
  const maxTop = areaBottom - height;
  if (maxTop < minTop) return minTop; // 領域より高いブロックは上端に揃えるだけ
  if (top >= minTop && top <= maxTop) return top;
  if (top < minTop) return Math.min(Math.ceil(minTop / pitch) * pitch, maxTop);
  return Math.max(Math.floor(maxTop / pitch) * pitch, minTop);
}

/** 行モードで最低限確保する折り返し幅（基準円でのpx値、全角6文字ぶん）。 */
export function minLineWrapWidthPx(fontPxAtReference: number): number {
  return fontPxAtReference * 6;
}

/** 行モードの左端xを、最低限の折り返し幅が右端（areaRight）まで残る範囲
 *  （[areaLeft, areaRight - 最低幅]）へ寄せる。 */
export function clampLineLeft(x: number, areaLeft: number, areaRight: number, fontPxAtReference: number): number {
  const minWrap = minLineWrapWidthPx(fontPxAtReference) / REFERENCE_RADIUS;
  const maxLeft = areaRight - minWrap;
  if (maxLeft < areaLeft) return areaLeft;
  return Math.min(Math.max(x, areaLeft), maxLeft);
}

/**
 * 折り返し済みの行（textLines）を、元の文章（text）の段落（改行で区切られた1行）ごとの
 * グループに分ける。折り返しは文字を欠かさず分割するだけなので、段落ごとに行を順に
 * 取り出して連結すると元の段落に戻る。戻らない（データが食い違っている）場合はnull。
 * 行モードのメモを段落（行）ごとに分けて動かすときに使う。
 */
export function groupRowsByParagraph(text: string, textLines: string[]): string[][] | null {
  const groups: string[][] = [];
  let i = 0;
  for (const paragraph of text.split("\n")) {
    const rows: string[] = [];
    if (paragraph === "") {
      if (textLines[i] !== "") return null;
      rows.push(textLines[i++]);
    } else {
      let joined = "";
      while (joined.length < paragraph.length) {
        if (i >= textLines.length || textLines[i] === "") return null;
        rows.push(textLines[i]);
        joined += textLines[i++];
      }
      if (joined !== paragraph) return null;
    }
    groups.push(rows);
  }
  return i === textLines.length ? groups : null;
}
