import { dateKeyFor, shiftDateKey } from "./dailyReset";
import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { ICONS } from "./icons";
import { renderMemoThumbnail } from "./memoRenderer";
import { dayOfWeek, drawWeekdayBadge } from "./recordGrid";
import { loadArchive } from "./storage";
import { DEFAULT_FONT_SIZE_STEP, FONT_SIZE_STEPS } from "./textLayout";
import { PEN_LINE_WIDTH } from "./toolStyle";
import type { DrawTool } from "./types";

/** 記録一覧画面（recordGrid.ts）への独立トリガーの器と、押した時に呼ぶ
 *  コールバック。containerは.toolbar（道具選択のピル）とは別の、呼び出し側
 *  （main.ts）が用意する独立したカード要素——ここに差し込むことで、道具選択
 *  ボタン群とは背景・角丸を共有しない見た目にする（ユーザー指示：完全に別で
 *  見えるようにしたい）。押すたびに開閉が入れ替わるトグルボタン（ユーザー
 *  指示：×ボタンを持たず、同じボタンをもう一度押すと閉じるiOS/Androidの
 *  アプリ切り替え画面のような操作感にしたい）——「今開いているかどうか」の
 *  判定・状態管理はonToggleの呼び出し側（main.ts）が持つ。 */
export interface RecordGridTriggerOptions {
  container: HTMLElement;
  onToggle: () => void;
}

/** トリガー内のサムネイル（過去の記録が1件以上ある場合の直近日プレビュー）の
 *  一辺（CSSピクセル）。ボタン本体（.toolbar-btn、2.375rem=38px）の内側に
 *  収まる大きさにする。 */
const RECORD_GRID_TRIGGER_THUMB_SIZE_PX = 26;

/** 昨日のキャンバスに何も書き込まれていない時の記録一覧トリガーの中身。
 *  紙の背景は描かず（26px四方と小さく、罫線入り紙を敷くと潰れて見えるため）、
 *  記録一覧のダミーセルと同じ円形の曜日バッジ（recordGrid.ts
 *  drawWeekdayBadge）だけをボタンいっぱいに描く。 */
function renderEmptyYesterdayBadge(canvas: HTMLCanvasElement, dateKey: string): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const size = RECORD_GRID_TRIGGER_THUMB_SIZE_PX;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const half = size / 2;
  drawWeekdayBadge(ctx, half, half, half, dayOfWeek(dateKey));
}

/** "none"は「道具なし」（選択中の道具をもう一度押して解除した状態、
 *  ユーザー指示）。ボタンには対応せず、setTool内部でだけ使う——canvasView.ts
 *  はこの間、描画・消去・移動などキャンバスへの操作を一切受け付けない。 */
export type ToolbarTool = DrawTool | "eraser" | "text" | "move" | "none";
/** ボタンとして実際に並ぶ道具（"none"を除いたToolbarTool）。TOOL_ORDERの
 *  要素をこちらに絞ることで、ICONS[tool]等のインデックスアクセスが
 *  "none"分のエントリを要求されずに型チェックを通る。 */
type SelectableTool = Exclude<ToolbarTool, "none">;

export const DEFAULT_INK = "oklch(22% 0.012 55)";

/** 「好きな色」の色相スライダーで選んだ色相(0〜360)を、実際に描画で使える
 *  インク色に変換する。settingsMenu.tsのcustomSwatchBackground()と同じ式
 *  （ペン・マーカーどちらにも使える、彩度控えめの中間的な明るさ）——専用の
 *  ネイティブ<input type="color">をやめてこちらに揃えたため、値の作り方も
 *  同じ考え方にしている。 */
function customInkColor(hue: number): string {
  return `oklch(75% 0.15 ${hue})`;
}

/** customInkColor()の逆変換。ペン・マーカーで「好きな色」の色相スライダーを
 *  共有しているため、ポップオーバーを開いた時点のスライダーの位置が、開く前に
 *  選んでいた道具の色相のまま残ってしまい、実際に今の道具で使われている色
 *  （スワッチの表示）とスライダーの位置がずれる不具合があった。ポップオーバーを
 *  開く直前に今の道具の色からここで色相を逆算し、スライダーへ書き戻すことで
 *  一致させる（customInkColor由来の値でなければnullを返し、その場合はスライダーを
 *  動かさない）。 */
function hueFromCustomInkColor(color: string): number | null {
  const match = /^oklch\(75% 0\.15 (-?\d+(?:\.\d+)?)\)$/.exec(color);
  return match ? Number(match[1]) : null;
}

/** 消しゴムの当たり判定半径（画面px、キャンバスの大きさに関わらず一定）の
 *  小/中/大の3段階。以前はペンの太さと同じくバーで連続的に選べるようにして
 *  いたが、「GoodNotesのように消しゴムは3段階の大きさから選ぶ形にしたい」
 *  というユーザー指示を受け、細かい調整よりも一目で選べることを優先して
 *  3段階のボタン選択に変更した（ペンの太さは連続スライダーのまま）。
 *  値は変更前の連続スライダーのmin/default/maxをそのまま踏襲している。 */
const ERASER_SIZE_STEPS = { small: 8, medium: 16, large: 40 } as const;
type EraserSizeStep = keyof typeof ERASER_SIZE_STEPS;
const ERASER_SIZE_STEP_ORDER: EraserSizeStep[] = ["small", "medium", "large"];
const ERASER_SIZE_STEP_LABEL: Record<EraserSizeStep, string> = { small: "小", medium: "中", large: "大" };
const ERASER_SIZE_STEP_ICON: Record<EraserSizeStep, string> = {
  small: ICONS.eraserSizeSmall,
  medium: ICONS.eraserSizeMedium,
  large: ICONS.eraserSizeLarge,
};

interface InkPreset {
  id: string;
  label: string;
  color: string;
}

/** すぐ選べる固定インク3色（GoodNotes風の定番色、ユーザー指示）。ペン・
 *  テキストなど、マーカー以外の道具で使う。「黒」は既存の既定インク色
 *  （DEFAULT_INK）をそのまま使う——見た目・初期状態を変えないため。 */
const PEN_PRESET_INKS: InkPreset[] = [
  { id: "black", label: "黒", color: DEFAULT_INK },
  { id: "red", label: "赤", color: "oklch(52% 0.2 25)" },
  { id: "blue", label: "青", color: "oklch(48% 0.16 258)" },
];

/** マーカー専用の固定インク3色。マーカーでは黒はまず使わないだろう、という
 *  ユーザー指示により、ペン等とは別に色の三原色（CMY：シアン・マゼンタ・
 *  イエロー）を用意した。当初はペンの赤・青と同じ暗め・高彩度の値にしていたが、
 *  「濃すぎる、GoodNotesのようにもう少しパステル寄りにしたい」という指摘を
 *  受け、明度を上げ彩度を落として蛍光ペン・ハイライター寄りの淡い発色に
 *  調整した。 */
const MARKER_PRESET_INKS: InkPreset[] = [
  { id: "cyan", label: "シアン", color: "oklch(85% 0.08 210)" },
  { id: "magenta", label: "マゼンタ", color: "oklch(82% 0.11 340)" },
  { id: "yellow", label: "イエロー", color: "oklch(90% 0.1 95)" },
];

/** 鉛筆とペンはほぼ同じ機能（線を描くだけ）だったため1つに統合した（ユーザー指示）。
 *  並び順はペン→マーカー→消しゴム→テキスト→選択（ユーザー指示）。「戻る」は
 *  道具ではなくこの並びの最後に別枠で続く（buildTools参照）。 */
const TOOL_ORDER: SelectableTool[] = ["pen", "marker", "eraser", "text", "move"];
const TOOL_LABEL: Record<ToolbarTool, string> = {
  pen: "ペン",
  marker: "マーカー",
  text: "テキスト",
  move: "選択",
  eraser: "消しゴム",
  none: "道具なし",
};

/**
 * Appleメモ風の道具バー: ペン／マーカー／テキスト／移動／消しゴムの切り替え、
 * フルカラーのインク色選択をまとめて扱う（鉛筆とペンはほぼ同じ機能だったため
 * 1つに統合した——ユーザー指示）。
 *
 * 見た目は下部に2枚の独立した浮いたカードとして分かれる（このToolbarクラスが
 * 両方を受け持つ、ユーザー指示：統合パネルではなくそれぞれ独立した見た目に
 * したい）:
 *   - 追従カード（colorSwatchContainer、#panel-swatch-slot）＝道具固有の
 *     詳細設定を、今選んでいる道具アイコンの真上に水平方向だけ追従させて
 *     表示する（ユーザー指示）。中身は道具によって出し分ける：
 *     ペン・マーカー・テキストの間はインクの色（固定3色＋「好きな色」の
 *     4スワッチ、buildSwatch）、消しゴムの間は大きさ（小/中/大、
 *     buildEraserSizeSteps）——どちらも同じカードの中で.hiddenを切り替えて
 *     排他的に表示する（syncFollowerCard参照）。選択（移動）の間はカード
 *     ごと非表示。カード自体（角丸・枠線・背景・影）は道具バー側と揃え、
 *     中身だけカード枠を持たない軽いアイコン列にする。
 *   - 道具バーのカード（.control-panel）内の.toolbar-tools＝「ツール選択
 *     ブロック」: 道具アイコンと「戻る」（issue #90）を同じ1列
 *     （.toolbar-pill）に、すべて同じ大きさ（.toolbar-btn）で並べる。
 *     文字サイズ・ペンの太さは選べる仕様をやめ、それぞれ
 *     DEFAULT_FONT_SIZE_STEP・PEN_LINE_WIDTH固定にした（ユーザー指示：PC操作
 *     でのペンは太さを都度選ぶ必要が薄い）ため、ここでは扱わない。
 *
 * DOMは初回に一度だけ組み立て、以降は状態が変わった箇所だけをピンポイントで
 * 更新する（innerHTMLを毎回作り直さない）。
 */
export class Toolbar {
  private el: HTMLElement;
  private container: HTMLElement;
  private colorSwatchContainer: HTMLElement;
  private onChange?: () => void;
  private onUndo?: () => void;
  /** 起動直後は道具なし状態にする（ユーザー指示）——開いてすぐ何かが選ばれて
   *  いるのではなく、ユーザーが最初に道具を選ぶまでキャンバスは待機状態。 */
  private tool: ToolbarTool = "none";
  /** マーカー以外（ペン・テキスト等）で使う色。消しゴムの大きさが
   *  ツールごとに別々の値を覚えているのと同じ考え方で、マーカーの色
   *  （markerColor）とは独立して覚えておく——マーカーで色を変えても、
   *  ペンに戻したときの色は変わらない。 */
  private drawColor: string = DEFAULT_INK;
  /** マーカーで使う色。既定はMARKER_PRESET_INKSの1つ目（シアン）。 */
  private markerColor: string = MARKER_PRESET_INKS[0].color;
  private eraserRadius: number = ERASER_SIZE_STEPS.medium;

  /** 記録一覧画面への独立トリガー本体。RecordGridTriggerOptionsが渡されな
   *  かった（呼び出し側が使わない）場合はnullのまま——refreshRecordGridTrigger
   *  は何もしない。 */
  private recordGridTriggerBtn: HTMLButtonElement | null = null;

  private toolButtons = new Map<ToolbarTool, HTMLButtonElement>();

  /** 消しゴムの大きさ（小/中/大）を選ぶボタンの行（buildEraserSizeSteps参照）。
   *  追従カード（colorSwatchContainer）内で.panel-swatches-row（色スワッチの
   *  行）と排他的に表示する（syncFollowerCard参照）。 */
  private eraserSizeWrap!: HTMLElement;
  private eraserSizeButtons = new Map<EraserSizeStep, HTMLButtonElement>();

  /** 色スワッチの行（buildSwatch参照）。追従カード内でeraserSizeWrapと
   *  排他的に表示する。 */
  private swatchRow!: HTMLElement;
  /** 固定3スワッチのボタン本体。IDでなく位置（0〜2）で持つ——道具が
   *  マーカーかどうかでPEN_PRESET_INKS/MARKER_PRESET_INKSのどちらを表示するか
   *  が変わるため、ボタン自体は使い回し、中身（背景色・ラベル）をsyncSwatchで
   *  差し替える。 */
  private presetButtons: HTMLButtonElement[] = [];
  private customSwatchBtn!: HTMLButtonElement;
  /** 「好きな色」ポップオーバーの器（.icon-anchor）・中身・開閉制御。以前は
   *  ネイティブの<input type="color">を直接クリックで開閉していたが、ネイティブ
   *  UIはページのCSSが一切効かずアニメーションを付けられない（ユーザー指示：
   *  一瞬で開閉せず徐々に見えるようにしたい）ため、テーマのカラーパレット
   *  （settingsMenu.ts）と同じ自前描画の色相スライダー＋.icon-popoverに
   *  置き換えた。createFadeVisibilityで他のポップオーバーと同じフェードを、
   *  exclusivePopoverで外側クリックでの自動クローズ・他ポップオーバーとの
   *  排他制御を担う。 */
  private customColorAnchor!: HTMLElement;
  private customColorPopover!: HTMLElement;
  private customColorPopoverFade!: (show: boolean) => void;
  private customColorPopoverOpen = false;
  private readonly closeCustomColorPopoverRef = () => this.closeCustomColorPopover();
  private hueSlider!: HTMLInputElement;
  /** カスタムスワッチ（4つ目）で一度でも選んだ色。GoodNotes同様、選んだ色は
   *  そのスワッチ自体の色として残り続け、次回はクリックひとつで呼び戻せる。
   *  ペン・マーカーどちらで選んでも共有する1つの値（枠は増やさない）。 */
  private customColor: string | null = null;

  constructor(
    container: HTMLElement,
    colorSwatchContainer: HTMLElement,
    onChange?: () => void,
    onUndo?: () => void,
    recordGridTrigger?: RecordGridTriggerOptions
  ) {
    this.container = container;
    this.colorSwatchContainer = colorSwatchContainer;
    this.onChange = onChange;
    this.onUndo = onUndo;

    this.el = document.createElement("div");
    this.el.className = "toolbar";
    this.container.appendChild(this.el);

    this.buildTools();
    if (recordGridTrigger) this.buildRecordGridTrigger(recordGridTrigger);
    this.buildEraserSizeSteps(this.colorSwatchContainer);
    this.buildSwatch(this.colorSwatchContainer);
    this.syncAll();

    // 画面幅が変わるとブレークポイントの切り替わり等でツール選択ボタンの
    // 位置自体がずれるため、追従カードの位置を追い直す（Toolbarはアプリの
    // 生存期間中1つだけ生成され破棄されないため、リスナーの解除は行わない
    // ——他のシングルトン的なクラスと同じ扱い）。
    window.addEventListener("resize", () => this.syncFollowerCard());
  }

  getTool(): ToolbarTool {
    return this.tool;
  }

  getColor(): string {
    return this.tool === "marker" ? this.markerColor : this.drawColor;
  }

  /** 今の道具に応じて表示すべき固定3色（マーカーだけ色の三原色、それ以外は
   *  黒/赤/青）。 */
  private activePresetInks(): InkPreset[] {
    return this.tool === "marker" ? MARKER_PRESET_INKS : PEN_PRESET_INKS;
  }

  /** 今の道具用の色を更新する（マーカーならmarkerColor、それ以外はdrawColor）。 */
  private setActiveColor(color: string): void {
    if (this.tool === "marker") this.markerColor = color;
    else this.drawColor = color;
  }

  /** 基準円(半径340px)におけるフォントサイズ(px)。選べる仕様をやめ常にDEFAULT_FONT_SIZE_STEP
   *  固定にした（ユーザー指示）。実際の描画時はtextLayout.fontPxForRenderでスケール・下限適用する。 */
  getFontSize(): number {
    return FONT_SIZE_STEPS[DEFAULT_FONT_SIZE_STEP];
  }

  /** 基準円(半径340px)におけるペンの線の太さ(px)。選べる仕様をやめ常に
   *  PEN_LINE_WIDTH固定にした（ユーザー指示：PC操作でのペンは太さを都度
   *  選ぶ必要が薄く、固定にして見た目をスッキリさせたい）。実際の描画時は
   *  toolStyle.toolRenderStyleでスケール・下限適用する。 */
  getLineWidth(): number {
    return PEN_LINE_WIDTH;
  }

  /** 消しゴムの当たり判定半径(画面px)。buildEraserSizeStepsの小/中/大の
   *  3段階から選ぶ（道具が消しゴムの間だけ表示・有効）。canvasView.tsの
   *  eraseAt呼び出しで使う。 */
  getEraserRadius(): number {
    return this.eraserRadius;
  }

  private setTool(tool: ToolbarTool): void {
    this.tool = tool;
    this.syncAll();
    this.onChange?.();
  }

  // --- 左ブロック（ツール選択ブロック）：道具アイコンを1列に -----

  private buildTools(): void {
    const tools = document.createElement("div");
    tools.className = "toolbar-tools";
    this.el.appendChild(tools);

    const pill = document.createElement("div");
    pill.className = "toolbar-pill";
    for (const tool of TOOL_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", TOOL_LABEL[tool]);
      btn.innerHTML = ICONS[tool];
      // 選択中の道具をもう一度押すと、道具なし状態へ解除する（ユーザー指示）
      // ——トグル的な挙動で、押すたびに選ぶ/解除するを繰り返せる。
      btn.addEventListener("click", () => this.setTool(this.tool === tool ? "none" : tool));
      this.attachToolTooltip(btn, TOOL_LABEL[tool]);
      this.toolButtons.set(tool, btn);
      pill.appendChild(btn);
    }

    // 「戻る」（issue #90）：モバイルの2本指タップは選択道具の間だけ動く
    // （canvasView.ts参照）ため、道具を問わず使える取り消し手段として定番の
    // ボタンをここに置く——道具選択とは違い押しても選んだ状態が残るわけ
    // ではないため、toolButtons（アクティブ表示の対象）には含めない。
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "toolbar-btn";
    undoBtn.setAttribute("aria-label", "戻る");
    undoBtn.innerHTML = ICONS.undo;
    undoBtn.addEventListener("click", () => this.onUndo?.());
    this.attachToolTooltip(undoBtn, "戻る");
    pill.appendChild(undoBtn);

    tools.appendChild(pill);
  }

  private syncPill(): void {
    for (const [tool, btn] of this.toolButtons) {
      const active = this.tool === tool;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }

  /** 記録一覧画面（recordGrid.ts）の開閉トリガー。既存のツール選択ボタン群
   *  （.toolbar-pill、道具バー本体）とは別に、呼び出し側が用意した独立カード
   *  （options.container、main.tsの#record-grid-trigger-slot）へ差し込む——
   *  DOM上も見た目上も道具バーとは別物にする（ユーザー指示：完全に別で
   *  見えるようにしたい）。押すたびに開閉が入れ替わるが、「今開いているか」の
   *  状態自体はonToggleの呼び出し側（main.ts）が持つため、道具ボタン
   *  （toolButtons）のようなaria-pressedでの押下状態表示はここでは持たせない。 */
  private buildRecordGridTrigger(options: RecordGridTriggerOptions): void {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toolbar-btn record-grid-trigger-btn";
    btn.setAttribute("aria-label", "過去の記録");
    btn.addEventListener("click", () => options.onToggle());
    this.attachToolTooltip(btn, "過去の記録");
    options.container.appendChild(btn);
    this.recordGridTriggerBtn = btn;
    this.refreshRecordGridTrigger();
  }

  /** トリガーの中身を最新状態に合わせて描き直す。1日前（昨日）のキャンバスに
   *  書き込みがあれば、その内容を小さく縮小レンダリングしたサムネイルを表示
   *  する。昨日に何も書かれていなければ（archiveされていなければ）、記録
   *  一覧のダミーセル（recordGrid.ts drawWeekdayBadge）と同じ、昨日の曜日を
   *  示す円形バッジを表示する（ユーザー指示：一日前のキャンバスに何も書き
   *  込まれていない場合は円形に曜日の文字を出す方式にしたい）——以前は
   *  「過去の記録が1件も無ければ固定のグリッドアイコン」という別扱いだったが、
   *  昨日を基準にした円形バッジがその場合（archiveが1件も無ければ昨日も
   *  当然空）も自然に包含するため、固定アイコンの出番自体が無くなった。
   *  朝リセットで新しい記録が増えた直後にも呼べるよう公開メソッドにしてある
   *  （main.tsのvisibilitychangeハンドラ参照）。 */
  refreshRecordGridTrigger(): void {
    const btn = this.recordGridTriggerBtn;
    if (!btn) return;
    const yesterdayKey = shiftDateKey(dateKeyFor(new Date()), -1);
    const memos = loadArchive(yesterdayKey);
    btn.innerHTML = "";
    const canvas = document.createElement("canvas");
    canvas.className = "record-grid-trigger-thumb";
    btn.appendChild(canvas);
    if (memos.length === 0) {
      renderEmptyYesterdayBadge(canvas, yesterdayKey);
    } else {
      renderMemoThumbnail(canvas, memos, RECORD_GRID_TRIGGER_THUMB_SIZE_PX);
    }
  }

  /** 道具ボタンにホバー用の小さな案内（ペン／マーカー／テキスト／選択／
   *  消しゴム）を付ける（ユーザー指示）。既存の他ポップオーバーと同じ
   *  .icon-popoverの見た目・フェード（createFadeVisibility）をそのまま流用し、
   *  1単語だけの案内なので.tool-tooltipで詰まった見た目に整える。タッチでは
   *  「押さずに触れる」状態が無く、タップの前後にちらつくだけになってしまう
   *  ため、pointerType==="mouse"のときだけ働かせる（PCに限る、というユーザー
   *  指示）。 */
  private attachToolTooltip(btn: HTMLButtonElement, label: string): void {
    const tooltip = document.createElement("span");
    tooltip.className = "icon-popover tool-tooltip";
    tooltip.textContent = label;
    tooltip.hidden = true;
    btn.appendChild(tooltip);
    const setVisible = createFadeVisibility(tooltip);
    btn.addEventListener("pointerenter", (ev) => {
      if (ev.pointerType === "mouse") setVisible(true);
    });
    btn.addEventListener("pointerleave", () => setVisible(false));
  }

  // --- 追従カード内・道具固有の数値調整（今は消しゴムの大きさのみ） ---

  /** 消しゴムの大きさを小/中/大の3段階のボタンから選ぶ（ユーザー指示：GoodNotes
   *  のように3段階から選ぶ形にしたい——以前はペンと連続スライダーを共有して
   *  いたが、ペンの太さ自体をPEN_LINE_WIDTH固定にしたためスライダーごと
   *  廃止した）。フレーム形状・柄の選択（appearanceSelector.ts）と同じ
   *  .toolbar-pill/.toolbar-btnの見た目を流用し、選択中のボタンだけ塗りつぶしの
   *  丸が濃く見えるようdata-activeでハイライトする。追従カード（container）に
   *  直接マウントし、道具が消しゴムの時だけ表示、それ以外は隠す
   *  （syncFollowerCard参照）——以前は道具バー内の別ブロックに固定表示して
   *  いたが、色スワッチと同じ追従カードへ統合した（ユーザー指示：消しゴムも
   *  追従に加えたい）。 */
  private buildEraserSizeSteps(container: HTMLElement): void {
    this.eraserSizeWrap = document.createElement("div");
    this.eraserSizeWrap.className = "toolbar-pill";

    for (const step of ERASER_SIZE_STEP_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", `消しゴムの大きさ: ${ERASER_SIZE_STEP_LABEL[step]}`);
      btn.innerHTML = ERASER_SIZE_STEP_ICON[step];
      btn.addEventListener("click", () => {
        this.eraserRadius = ERASER_SIZE_STEPS[step];
        this.syncEraserSizeSteps();
        this.onChange?.();
      });
      this.eraserSizeButtons.set(step, btn);
      this.eraserSizeWrap.appendChild(btn);
    }

    container.appendChild(this.eraserSizeWrap);
  }

  private syncEraserSizeSteps(): void {
    for (const [step, btn] of this.eraserSizeButtons) {
      const active = ERASER_SIZE_STEPS[step] === this.eraserRadius;
      btn.dataset.active = String(active);
      btn.setAttribute("aria-pressed", String(active));
    }
  }

  /**
   * インクの色: すぐ選べる固定3スワッチ＋4つ目の「好きな色」スワッチを横に
   * 並べる（ユーザー指示：GoodNotesのように定番色をすぐ選べるようにし、4つ目
   * でRGBの好きな色を選べるようにしたい）。固定3色は道具によって中身が変わる
   * （マーカーだけ色の三原色、それ以外は黒/赤/青——ユーザー指示：マーカーで
   * 黒はまず使わない）ため、ボタン自体は3つ作って使い回し、背景色・ラベルは
   * syncSwatchで今の道具に合わせて差し替える。
   * 道具バー（.control-panel）とは別の独立したカード（colorSwatchContainer、
   * #panel-swatch-slot、style.css .panel-swatches）に常設する（ユーザー指示）。
   * カード自体の見た目は道具バーと揃え、この行（.panel-swatches-row）自体は
   * 個別のカード枠を持たせずアイコン・スワッチだけを直接並べる。
   */
  private buildSwatch(container: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "toolbar-swatches panel-swatches-row";
    this.swatchRow = row;

    for (let i = 0; i < 3; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-swatch";
      btn.addEventListener("click", () => {
        this.setActiveColor(this.activePresetInks()[i].color);
        this.syncSwatch();
        this.onChange?.();
      });
      this.presetButtons.push(btn);
      row.appendChild(btn);
    }

    // 4つ目「好きな色」。ネイティブの<input type="color">はやめ、テーマの
    // カラーパレット（settingsMenu.ts）と同じ自前描画の色相スライダーを
    // .icon-popoverの中に置く（ユーザー指示：開閉を徐々に見えるようにしたい
    // ——ネイティブUIではCSSが一切効かないため実現できなかった）。
    this.customColorAnchor = document.createElement("div");
    this.customColorAnchor.className = "icon-anchor toolbar-custom-color-anchor";

    // 未使用のうちは「好きな色」だと一目で分かるよう虹色の見た目にする
    // （style.cssの.toolbar-swatch--custom）。一度選んだ後は、その色そのものを
    // 背景に出す（インラインstyleがクラス由来の背景より優先される）。
    this.customSwatchBtn = document.createElement("button");
    this.customSwatchBtn.type = "button";
    this.customSwatchBtn.className = "toolbar-swatch toolbar-swatch--custom";
    this.customSwatchBtn.setAttribute("aria-label", "好きな色を選ぶ");
    this.customSwatchBtn.addEventListener("click", () => this.toggleCustomColorPopover());
    this.customColorAnchor.appendChild(this.customSwatchBtn);

    this.customColorPopover = document.createElement("div");
    this.customColorPopover.className = "icon-popover toolbar-custom-color-popover";
    this.customColorPopover.hidden = true;
    this.customColorPopoverFade = createFadeVisibility(this.customColorPopover);

    this.hueSlider = document.createElement("input");
    this.hueSlider.type = "range";
    this.hueSlider.min = "0";
    this.hueSlider.max = "360";
    this.hueSlider.step = "1";
    this.hueSlider.value = "0";
    this.hueSlider.className = "theme-hue-slider";
    this.hueSlider.setAttribute("aria-label", "好きな色を選ぶ");
    this.hueSlider.addEventListener("input", () => {
      this.customColor = customInkColor(Number(this.hueSlider.value));
      this.setActiveColor(this.customColor);
      this.syncSwatch();
      this.onChange?.();
    });
    this.customColorPopover.appendChild(this.hueSlider);
    this.customColorAnchor.appendChild(this.customColorPopover);

    row.appendChild(this.customColorAnchor);

    container.appendChild(row);
  }

  private toggleCustomColorPopover(): void {
    if (this.customColorPopoverOpen) this.closeCustomColorPopover();
    else this.openCustomColorPopover();
  }

  private openCustomColorPopover(): void {
    if (this.customColorPopoverOpen) return;
    // ペン・マーカーでスライダー（this.hueSlider）を共有しているため、開く前に
    // 別の道具で動かした位置のまま残っていることがある。今の道具の実際の色に
    // スライダーを合わせ直してから開く（表示されている色とスライダー位置の
    // 不一致を防ぐ）。
    const hue = hueFromCustomInkColor(this.getColor());
    if (hue !== null) this.hueSlider.value = String(hue);
    notifyOpen(this.closeCustomColorPopoverRef, this.customColorAnchor);
    this.customColorPopoverOpen = true;
    this.customColorPopoverFade(true);
  }

  private closeCustomColorPopover(): void {
    if (!this.customColorPopoverOpen) return;
    this.customColorPopoverOpen = false;
    this.customColorPopoverFade(false);
    notifyClose(this.closeCustomColorPopoverRef);
  }

  /** 今の道具の固定3色（activePresetInks）をスワッチの背景・ラベルに反映し、
   *  今の色（getColor）と一致するスワッチだけにリングを付けて選択中を示す
   *  （文字列比較でよい——色の値はすべてこのクラス自身が設定するため、ユーザー
   *  入力の表記ゆれを考慮する必要がない）。色を使わない道具（選択・消しゴム）
   *  を選んでいる間はこの行ごと非表示になる（syncFollowerCard参照）ため、
   *  ここでは常に「表示されている＝色を使う道具である」前提で組み立てる。 */
  private syncSwatch(): void {
    const presets = this.activePresetInks();
    const color = this.getColor();
    let isPresetActive = false;
    presets.forEach((preset, i) => {
      const btn = this.presetButtons[i];
      btn.style.background = preset.color;
      btn.setAttribute("aria-label", `インクの色: ${preset.label}`);
      const active = preset.color === color;
      btn.dataset.active = String(active);
      if (active) isPresetActive = true;
    });
    this.customSwatchBtn.dataset.active = String(!isPresetActive);
    // このスワッチが選択中（＝3色プリセットのどれとも一致しない色を使っている）
    // 間は、必ず今の道具の実際の色（color）をそのまま映す。this.customColorは
    // ペン・マーカーで共有する1つの値のため、片方で選んだ後もう片方の道具に
    // 切り替えて別の色相を選ぶと、選択中でない側のcustomColorが上書きされ、
    // スワッチの背景（表示されている色）が実際に描画される色（書かれている色）と
    // 食い違う不具合があった。選択中でない間だけ、次に呼び戻せるよう最後に
    // 選んだ好きな色を控えとして表示する。
    if (!isPresetActive) {
      this.customSwatchBtn.style.background = color;
    } else if (this.customColor) {
      this.customSwatchBtn.style.background = this.customColor;
    }
    this.syncToolIcons();
  }

  /** 追従カード（colorSwatchContainer）を、今選んでいる道具アイコンの真上に
   *  水平方向だけ追従させる（ユーザー指示）。中身は道具ごとに出し分ける
   *  （色スワッチ⇔消しゴムの大きさ、ユーザー指示：消しゴムも追従に加えたい）。
   *  どちらも使わない道具（選択）の間はカードごと非表示にする——道具アイコンの
   *  真上に付いてくる以上、道具固有の設定を持たない道具の上に空・グレーの
   *  カードが乗っているとかえって紛らわしいため。
   *  位置合わせはtransform: translateXで行う——レイアウト上の「本来の
   *  中央位置」（.app-footerのalign-items:centerによる中央寄せ）はそのままに、
   *  見た目の位置だけをずらす。
   *  この「本来の中央位置」を、カード自身のgetBoundingClientRect()（＝今の
   *  transformを含んだ見た目上の位置）からではなく、親の.app-footerの中央
   *  （footerRect.left + footerRect.width/2）から計算する——カードは
   *  align-items:centerでfooterの中央に置かれるため、カード自身の transform
   *  に一切左右されない。以前はカード自身のtransformを一度リセットしてから
   *  測る方式だったが、transitionが効いたままだとリセット直後の
   *  getBoundingClientRect()がアニメーション開始直後の「ほぼ直前の値」を
   *  返してしまい、切り替えるたびに一瞬本来の位置を通り過ぎてから補正が
   *  入るという見た目のガタつきがあった（ユーザー報告）。footer基準の計算に
   *  変えたことで、カード自身のtransform状態を一切見ずに済み、この問題ごと
   *  無くなる。 */
  private syncFollowerCard(): void {
    const showsSwatches = this.tool === "pen" || this.tool === "marker" || this.tool === "text";
    const showsEraserSizes = this.tool === "eraser";
    this.swatchRow.hidden = !showsSwatches;
    this.eraserSizeWrap.hidden = !showsEraserSizes;
    if (!showsSwatches) this.closeCustomColorPopover();

    if (!showsSwatches && !showsEraserSizes) {
      this.colorSwatchContainer.hidden = true;
      return;
    }
    this.colorSwatchContainer.hidden = false;

    const btn = this.toolButtons.get(this.tool);
    const footer = this.colorSwatchContainer.closest(".app-footer");
    if (!btn || !(footer instanceof HTMLElement)) return;
    const footerRect = footer.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const naturalCenterX = footerRect.left + footerRect.width / 2;
    const offset = btnRect.left + btnRect.width / 2 - naturalCenterX;
    this.colorSwatchContainer.style.transform = `translateX(${offset}px)`;
  }

  /** ペン・マーカーそれぞれの道具ボタン自身のペン先（ICONS.pen/markerの
   *  インクだまり部分、--pen-tip-color/--marker-tip-color）に、今選んで
   *  いる色（drawColor/markerColor）を反映する。GoodNotesのように、
   *  道具を切り替えなくてもボタンを見れば今どの色で描くかが分かるように
   *  する（ユーザー指示）。 */
  private syncToolIcons(): void {
    const penBtn = this.toolButtons.get("pen");
    penBtn?.style.setProperty("--pen-tip-color", this.drawColor);
    const markerBtn = this.toolButtons.get("marker");
    markerBtn?.style.setProperty("--marker-tip-color", this.markerColor);
  }

  private syncAll(): void {
    this.syncPill();
    this.syncEraserSizeSteps();
    this.syncSwatch();
    this.syncFollowerCard();
  }
}
