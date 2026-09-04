import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { ICONS } from "./icons";
import { DEFAULT_FONT_SIZE_STEP, FONT_SIZE_STEPS } from "./textLayout";
import { PEN_LINE_WIDTH } from "./toolStyle";
import type { DrawTool } from "./types";

export type ToolbarTool = DrawTool | "eraser" | "text" | "move";

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

/** 鉛筆とペンはほぼ同じ機能（線を描くだけ）だったため1つに統合した（ユーザー指示）。 */
const TOOL_ORDER: ToolbarTool[] = ["pen", "marker", "text", "move", "eraser"];
const TOOL_LABEL: Record<ToolbarTool, string> = {
  pen: "ペン",
  marker: "マーカー",
  text: "テキスト",
  move: "選択",
  eraser: "消しゴム",
};

/**
 * Appleメモ風の道具バー: ペン／マーカー／テキスト／移動／消しゴムの切り替え、
 * フルカラーのインク色選択をまとめて扱う（鉛筆とペンはほぼ同じ機能だったため
 * 1つに統合した——ユーザー指示）。
 *
 * 下部バーは機能ごとに2ブロックへ分けており、このToolbarクラスはその両方を
 * 受け持つ:
 *   - 左（.toolbar-tools）＝「ツール選択ブロック」: 道具アイコンと「戻る」
 *     （issue #90）を同じ1列（.toolbar-pill）に、すべて同じ大きさ
 *     （.toolbar-btn）で並べる。「何をするか」という操作そのものの並びとして、
 *     1つのブロックにまとめている（ユーザー指示：ツールを左に1ブロックと
 *     してまとめたい）。
 *   - 中央（.toolbar-details）＝「ツールの詳細ブロック」: 色・サイズという、
 *     選んだ道具の見た目を決める設定。文字サイズは選べる仕様をやめ常に
 *     DEFAULT_FONT_SIZE_STEP固定にしたため、ここでは扱わない。
 *     ペンの太さも、当初はGoodNotesのようにバーで連続的に選べるようにして
 *     いたが、「メインのターゲット層はPCを使う人で、ペン（マウス操作）で
 *     文字を書くのは難しく太さも都度選ぶ必要が薄いので、固定にして見た目を
 *     スッキリさせたい」というユーザー指示によりPEN_LINE_WIDTH固定にした
 *     （toolStyle.ts参照）ため、ここでも扱わない。
 *     消しゴムの大きさは、当初はペンの太さスライダーと共有していたが、
 *     「GoodNotesのように消しゴムは3段階の大きさから選ぶ形にしたい」という
 *     ユーザー指示を受け、小/中/大の3段階のボタン選択（buildEraserSizeSteps）
 *     に分けた——道具がペンの間は色スワッチだけ、消しゴムの間はこのボタンだけ、
 *     という形で同じ位置に出し分ける。
 * 画面切り替えナビをヘッダー側に移した分フッターの横幅に余裕ができたため、
 * 以前は道具アイコンの上にposition: absoluteで浮かせていた詳細ブロックを
 * 通常のフローに戻し、ブロックを横に並べるだけで1行に収まるようにしている。
 *
 * DOMは初回に一度だけ組み立て、以降は状態が変わった箇所だけをピンポイントで
 * 更新する（innerHTMLを毎回作り直さない）。
 */
export class Toolbar {
  private el: HTMLElement;
  private container: HTMLElement;
  private onChange?: () => void;
  private onUndo?: () => void;
  private tool: ToolbarTool = "pen";
  /** マーカー以外（ペン・テキスト等）で使う色。消しゴムの大きさが
   *  ツールごとに別々の値を覚えているのと同じ考え方で、マーカーの色
   *  （markerColor）とは独立して覚えておく——マーカーで色を変えても、
   *  ペンに戻したときの色は変わらない。 */
  private drawColor: string = DEFAULT_INK;
  /** マーカーで使う色。既定はMARKER_PRESET_INKSの1つ目（シアン）。 */
  private markerColor: string = MARKER_PRESET_INKS[0].color;
  private eraserRadius: number = ERASER_SIZE_STEPS.medium;

  private toolButtons = new Map<ToolbarTool, HTMLButtonElement>();

  /** 消しゴムの大きさ（小/中/大）を選ぶボタン。.toolbar-details内の同じ位置を
   *  カラースワッチと奪い合う形で、道具が消しゴムの時だけこちらを表示し、
   *  それ以外（色を使う道具）の間はカラースワッチを表示する
   *  （buildEraserSizeSteps参照）。 */
  private eraserSizeWrap!: HTMLElement;
  private eraserSizeButtons = new Map<EraserSizeStep, HTMLButtonElement>();

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
  private swatchRow!: HTMLElement;
  /** カスタムスワッチ（4つ目）で一度でも選んだ色。GoodNotes同様、選んだ色は
   *  そのスワッチ自体の色として残り続け、次回はクリックひとつで呼び戻せる。
   *  ペン・マーカーどちらで選んでも共有する1つの値（枠は増やさない）。 */
  private customColor: string | null = null;

  constructor(container: HTMLElement, onChange?: () => void, onUndo?: () => void) {
    this.container = container;
    this.onChange = onChange;
    this.onUndo = onUndo;

    this.el = document.createElement("div");
    this.el.className = "toolbar";
    this.container.appendChild(this.el);

    this.buildTools();
    this.buildDetails();
    this.syncAll();
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
    tools.className = "toolbar-tools control-block";
    this.el.appendChild(tools);

    const pill = document.createElement("div");
    pill.className = "toolbar-pill";
    for (const tool of TOOL_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", TOOL_LABEL[tool]);
      btn.innerHTML = ICONS[tool];
      btn.addEventListener("click", () => this.setTool(tool));
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

  // --- 中央ブロック（ツールの詳細ブロック）：色・サイズ -----------------------

  /** モバイル幅では.toolbar-details自身がグリッドの1マス（展開/収納される行）
   *  になる（style.css参照）。padding/borderをこの要素自身に持たせると、
   *  グリッド行を高さ0まで畳んでもその分だけ隙間が残ってしまうため
   *  （padding/borderはoverflow:hiddenで隠せる「中身」に含まれない）、
   *  見た目（.control-block）は内側のカードに持たせ、この要素自体は
   *  中身に応じて0まで縮められる素の器にしておく。 */
  private buildDetails(): void {
    const details = document.createElement("div");
    details.className = "toolbar-details";
    this.el.appendChild(details);

    const card = document.createElement("div");
    card.className = "toolbar-details-card control-block";
    details.appendChild(card);

    this.buildEraserSizeSteps(card);
    this.buildSwatch(card);
  }

  /** 消しゴムの大きさを小/中/大の3段階のボタンから選ぶ（ユーザー指示：GoodNotes
   *  のように3段階から選ぶ形にしたい——以前はペンと連続スライダーを共有して
   *  いたが、ペンの太さ自体をPEN_LINE_WIDTH固定にしたためスライダーごと
   *  廃止した）。フレーム形状・柄の選択（appearanceSelector.ts）と同じ
   *  .toolbar-pill/.toolbar-btnの見た目を流用し、選択中のボタンだけ塗りつぶしの
   *  丸が濃く見えるようdata-activeでハイライトする。道具が消しゴムの時だけ
   *  表示し、それ以外は隠す（syncEraserSizeSteps参照）。 */
  private buildEraserSizeSteps(details: HTMLElement): void {
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

    details.appendChild(this.eraserSizeWrap);
  }

  private syncEraserSizeSteps(): void {
    this.eraserSizeWrap.hidden = this.tool !== "eraser";
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
   */
  private buildSwatch(details: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "toolbar-swatches";
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

    details.appendChild(row);
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
   *  入力の表記ゆれを考慮する必要がない）。
   *  色を使わない道具（選択・消しゴム）を選んでいる間は、パレット全体を
   *  無効化する——押しても意味を持たないボタンが常に押せる状態のままなのは
   *  分かりにくい（issue #68）。
   *  消しゴムの間はさらに一歩進めて非表示にする——消しゴムの大きさ選択
   *  （buildEraserSizeSteps）が同じ.toolbar-details内の見た目上の位置を使う
   *  ため、グレーアウトのまま残すと3段階ボタンの隣に無意味な色パレットが
   *  居座って見える（ユーザー指摘：消しゴムでは色の固定部分を表示しないでほしい）。 */
  private syncSwatch(): void {
    const enabled = this.tool === "pen" || this.tool === "marker" || this.tool === "text";
    this.swatchRow.hidden = this.tool === "eraser";
    const presets = this.activePresetInks();
    const color = this.getColor();
    let isPresetActive = false;
    presets.forEach((preset, i) => {
      const btn = this.presetButtons[i];
      btn.style.background = preset.color;
      btn.setAttribute("aria-label", `インクの色: ${preset.label}`);
      btn.disabled = !enabled;
      const active = preset.color === color;
      btn.dataset.active = String(active);
      if (active) isPresetActive = true;
    });
    this.customSwatchBtn.dataset.active = String(!isPresetActive);
    this.customSwatchBtn.disabled = !enabled;
    this.hueSlider.disabled = !enabled;
    if (!enabled) this.closeCustomColorPopover();
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
    this.swatchRow.classList.toggle("toolbar-swatches-disabled", !enabled);
    this.syncToolIcons();
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
  }
}
