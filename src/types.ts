export interface Point {
  x: number;
  y: number;
}

export type Stroke = Point[];

type MemoStatus = "active" | "faded";

/** 描画ツール（見た目・太さ・質感）。
 *  以前は鉛筆／ペン／マーカーの3種類だったが、鉛筆とペンはほぼ同じ機能
 *  だったため1つ（pen）に統合した（ユーザー指示）。 */
export type DrawTool = "pen" | "marker";

interface MemoBase {
  id: string;
  /** メモの代表座標（手書き=最初のストロークの始点、テキスト=テキストブロックの中心）。
   *  円の中心を原点とする、円の半径を1とした正規化座標系。 */
  x: number;
  y: number;
  createdAt: number;
  /** "active"のメモだけがキャンバスに表示される。"faded"は経時フェード
   *  機能があった旧バージョンのデータ由来の値で、現在の版はこの状態へは
   *  遷移させない（読み込み時の後方互換のためだけに型として残す）。 */
  status: MemoStatus;
  /** CSS色文字列（既定は本体のインク色と同じoklch文字列、ユーザーが選べば任意の色になる） */
  color: string;
}

/** 手描きの手書きメモ（ドラッグでのストローク）。 */
export interface StrokeMemo extends MemoBase {
  kind: "stroke";
  strokes: Stroke[];
  tool: DrawTool;
  /** 基準円（半径340px）における線の太さ(px)。ペン（pen）の太さは小・中・大の
   *  ステッパーでユーザーが選べる（ユーザー指示：鉛筆とペンの統合にあわせて
   *  サイズ変更を効かせたい）。マーカー（marker）は固定太さなので使わない。
   *  省略時（この項目が無かった旧バージョンのデータ）はtoolStyle側で
   *  ペンの「中」相当にフォールバックする。 */
  lineWidth?: number;
}

/** テキスト入力のメモ。 */
export interface TextMemo extends MemoBase {
  kind: "text";
  /** ユーザーが入力した元のテキスト（改行を含む）。 */
  text: string;
  /** 折り返し済みの行。作成時に一度だけ計算し、以後はこれをそのまま描画に使う
   *  （基準円=半径340pxでの折り返し結果なので、実際の半径に関わらず行分割は変わらない）。 */
  textLines: string[];
  /** 基準円（半径340px）におけるフォントサイズ(px)。実際の描画時は現在の半径に比例させ、
   *  読みやすさのための下限(MIN_FONT_PX)を必ず適用する。 */
  fontSize: number;
  /** 折り返し幅。円の半径を1とする正規化単位。 */
  boxWidth: number;
  /** 行数から決まるテキストブロックの高さ。円の半径を1とする正規化単位。
   *  消しゴムの当たり判定に使う。 */
  boxHeight: number;
  /** 行の横方向の揃え方。省略時（既存データ含む）は"center"として扱う。
   *  持ち物チェックのテンプレートのように項目を縦に並べる文面は、行ごとに
   *  幅が違っても左端が揃って読みやすい"left"にする。 */
  align?: "center" | "left";
  /** 行の高さ（フォントサイズに対する倍率）。省略時（既存データ含む）は
   *  textLayout.LINE_HEIGHT_MULTIPLIERとして扱う。テンプレートを置いた
   *  瞬間だけ、これより少し狭い専用の値（textLayout.TEMPLATE_LINE_HEIGHT_MULTIPLIER）
   *  にする（ユーザー指示：テンプレートのみ行間を少し狭くしたい）。 */
  lineHeight?: number;
}

export type Memo = StrokeMemo | TextMemo;

/** 新しい手描きメモを作るときの見た目の指定。 */
export interface MemoStyle {
  tool: DrawTool;
  color: string;
  /** 基準円（半径340px）における線の太さ(px)。ペンのときだけ意味を持つ
   *  （StrokeMemo.lineWidth参照）。 */
  lineWidth: number;
}
