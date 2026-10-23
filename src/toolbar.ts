import { createFadeVisibility } from "./fadeVisibility";
import { ICONS } from "./icons";
import { DEFAULT_FONT_SIZE_STEP, FONT_SIZE_STEPS } from "./textLayout";
import { DEFAULT_LIGHT_INK, isDarkThemeActive, resolveInkColor } from "./theme";
import { PEN_LINE_WIDTH } from "./toolStyle";
import type { DrawTool } from "./types";

export interface TopRightBarOptions {
  container: HTMLElement;
  onToggleDarkMode?: () => void;
}

export type ToolbarTool = DrawTool | "eraser" | "text" | "move" | "none";
type SelectableTool = Exclude<ToolbarTool, "none">;

export const DEFAULT_INK = DEFAULT_LIGHT_INK;

const DEFAULT_ERASER_RADIUS = 16;

interface InkPreset {
  id: string;
  label: string;
  color: string;
}

const PEN_PRESET_INKS: InkPreset[] = [
  { id: "black", label: "黒", color: DEFAULT_INK },
  { id: "red", label: "赤", color: "oklch(52% 0.2 25)" },
  { id: "blue", label: "青", color: "oklch(48% 0.16 258)" },
];

const MARKER_PRESET_INKS: InkPreset[] = [
  { id: "cyan", label: "シアン", color: "oklch(85% 0.08 210)" },
  { id: "magenta", label: "マゼンタ", color: "oklch(82% 0.11 340)" },
  { id: "yellow", label: "イエロー", color: "oklch(90% 0.1 95)" },
];

const TOOL_ORDER: SelectableTool[] = ["pen", "marker", "eraser", "text", "move"];
const TOOL_LABEL: Record<ToolbarTool, string> = {
  pen: "ペン",
  marker: "マーカー",
  text: "テキスト",
  move: "移動・並べ替え",
  eraser: "消しゴム",
  none: "道具なし",
};

/**
 * 左下の道具バー: ペン／マーカー／消しゴム／テキスト／選択の切り替えと
 * 取り消し（戻る）を1列のピルにまとめて扱う。
 *
 * 右上の独立ピル（#record-grid-trigger-slot）には、エクスポート・
 * ダークモード切替・日付の切り替え（◀ [曜日バッジ] ▶）をまとめて配置する。
 *
 * 右下のカラーバー（colorSwatchContainer、#panel-swatch-slot）は、
 * 色を使う道具（ペン・マーカー・テキスト）を選択した時にアニメーション付きで
 * 表示し、それ以外の時は非表示にする。
 */
export class Toolbar {
  private el: HTMLElement;
  private container: HTMLElement;
  private colorSwatchContainer: HTMLElement;
  private onChange?: (kind: "tool" | "color") => void;
  private onUndo?: () => void;
  private onRedo?: () => void;
  private onToggleDarkMode?: () => void;
  private tool: ToolbarTool = "none";
  private drawColor: string = DEFAULT_INK;
  private markerColor: string = MARKER_PRESET_INKS[0].color;
  private eraserRadius: number = DEFAULT_ERASER_RADIUS;

  private toolButtons = new Map<ToolbarTool, HTMLButtonElement>();
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private darkModeBtn: HTMLButtonElement | null = null;
  private darkModeIconSlot: HTMLSpanElement | null = null;

  private presetButtons: HTMLButtonElement[] = [];
  private lastSwatchPaletteMode: "pen" | "marker" | null = null;
  constructor(
    container: HTMLElement,
    colorSwatchContainer: HTMLElement,
    onChange?: (kind: "tool" | "color") => void,
    onUndo?: () => void,
    onRedo?: () => void,
    options?: TopRightBarOptions
  ) {
    this.container = container;
    this.colorSwatchContainer = colorSwatchContainer;
    this.onChange = onChange;
    this.onUndo = onUndo;
    this.onRedo = onRedo;
    this.onToggleDarkMode = options?.onToggleDarkMode;

    this.el = document.createElement("div");
    this.el.className = "toolbar";
    this.container.appendChild(this.el);

    this.buildTools();
    if (options) this.buildTopRightBar(options);
    this.buildSwatch(this.colorSwatchContainer);
    this.syncAll();
  }

  getTool(): ToolbarTool {
    return this.tool;
  }

  getColor(): string {
    return this.tool === "marker" ? this.markerColor : this.drawColor;
  }

  private activePresetInks(): InkPreset[] {
    return this.tool === "marker" ? MARKER_PRESET_INKS : PEN_PRESET_INKS;
  }

  private setActiveColor(color: string): void {
    if (this.tool === "marker") this.markerColor = color;
    else this.drawColor = color;
  }

  getFontSize(): number {
    return FONT_SIZE_STEPS[DEFAULT_FONT_SIZE_STEP];
  }

  getLineWidth(): number {
    return PEN_LINE_WIDTH;
  }

  getEraserRadius(): number {
    return this.eraserRadius;
  }

  private setTool(tool: ToolbarTool): void {
    this.tool = tool;
    this.syncAll();
    this.onChange?.("tool");
  }

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
      btn.addEventListener("click", () => this.setTool(this.tool === tool ? "none" : tool));
      this.attachToolTooltip(btn, TOOL_LABEL[tool]);
      this.toolButtons.set(tool, btn);
      pill.appendChild(btn);
    }

    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "toolbar-btn";
    undoBtn.setAttribute("aria-label", "戻る");
    undoBtn.innerHTML = ICONS.undo;
    undoBtn.addEventListener("click", () => this.onUndo?.());
    this.attachToolTooltip(undoBtn, "戻る");
    this.undoBtn = undoBtn;
    pill.appendChild(undoBtn);

    const redoBtn = document.createElement("button");
    redoBtn.type = "button";
    redoBtn.className = "toolbar-btn";
    redoBtn.setAttribute("aria-label", "やり直す");
    redoBtn.innerHTML = ICONS.redo;
    redoBtn.addEventListener("click", () => this.onRedo?.());
    this.attachToolTooltip(redoBtn, "やり直す");
    this.redoBtn = redoBtn;
    pill.appendChild(redoBtn);

    tools.appendChild(pill);
  }

  /** ダークモード切替時やOSのカラースキーム変化時に呼び出し、アイコンおよび
   *  黒インクのスワッチ・ペン先表示色を現在のモードに合わせて更新する。 */
  syncThemeState(): void {
    const dark = isDarkThemeActive();
    if (this.darkModeIconSlot) {
      this.darkModeIconSlot.innerHTML = dark ? ICONS.lightMode : ICONS.darkMode;
    }
    if (this.darkModeBtn) {
      this.darkModeBtn.setAttribute("aria-pressed", String(dark));
    }
    this.syncSwatch();
  }

  private syncPill(): void {
    for (const [tool, btn] of this.toolButtons) {
      const active = this.tool === tool;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }

  private buildTopRightBar(options: TopRightBarOptions): void {
    const row = document.createElement("div");
    row.className = "record-grid-trigger-row";

    // ダークモード切替ボタン（1クリックでライト⇔ダークを即座に切り替える）。
    const darkModeBtn = document.createElement("button");
    darkModeBtn.type = "button";
    darkModeBtn.className = "toolbar-btn";
    darkModeBtn.setAttribute("aria-label", "ダークモード切替");
    const darkModeIconSlot = document.createElement("span");
    darkModeIconSlot.className = "toolbar-btn-icon-slot";
    darkModeBtn.appendChild(darkModeIconSlot);
    darkModeBtn.addEventListener("click", () => {
      this.onToggleDarkMode?.();
      this.syncThemeState();
    });
    this.attachToolTooltip(darkModeBtn, "ダークモード");
    this.darkModeBtn = darkModeBtn;
    this.darkModeIconSlot = darkModeIconSlot;
    row.appendChild(darkModeBtn);

    options.container.appendChild(row);
  }

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

  private buildSwatch(container: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "toolbar-swatches panel-swatches-row";

    for (let i = 0; i < 3; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-swatch";
      // テキスト入力中に色スワッチを押しても、<textarea>のフォーカスが外れて入力が
      // 閉じてしまわないようにする（編集中はその場で色だけ切り替える）。
      const keepFocus = (ev: Event) => ev.preventDefault();
      btn.addEventListener("pointerdown", keepFocus);
      btn.addEventListener("mousedown", keepFocus);
      btn.addEventListener("click", () => {
        this.setActiveColor(this.activePresetInks()[i].color);
        this.syncSwatch();
        this.onChange?.("color");
      });
      this.presetButtons.push(btn);
      row.appendChild(btn);
    }

    container.appendChild(row);
  }

  private syncSwatch(): void {
    const paletteMode: "pen" | "marker" = this.tool === "marker" ? "marker" : "pen";
    const paletteChanged =
      this.lastSwatchPaletteMode !== null &&
      this.lastSwatchPaletteMode !== paletteMode &&
      (this.tool === "pen" || this.tool === "marker" || this.tool === "text");
    this.lastSwatchPaletteMode = paletteMode;

    const presets = this.activePresetInks();
    const color = this.getColor();
    presets.forEach((preset, i) => {
      const btn = this.presetButtons[i];
      btn.style.backgroundColor = resolveInkColor(preset.color);
      btn.setAttribute("aria-label", `インクの色: ${preset.label}`);
      const active = preset.color === color;
      btn.dataset.active = String(active);
      if (paletteChanged && typeof btn.animate === "function") {
        btn.animate(
          [
            { transform: "scale(1)" },
            { transform: "scale(0.8)", offset: 0.4 },
            { transform: "scale(1)" },
          ],
          {
            duration: 240,
            delay: i * 25,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          }
        );
      }
    });
    this.syncToolIcons();
  }

  private syncFollowerCard(): void {
    const isColorActive = this.tool === "pen" || this.tool === "marker" || this.tool === "text";
    this.colorSwatchContainer.dataset.visible = String(isColorActive);
    this.colorSwatchContainer.setAttribute("aria-hidden", String(!isColorActive));
    for (const btn of this.presetButtons) {
      btn.disabled = !isColorActive;
      btn.tabIndex = isColorActive ? 0 : -1;
    }
  }

  private syncToolIcons(): void {
    const penBtn = this.toolButtons.get("pen");
    penBtn?.style.setProperty("--pen-tip-color", resolveInkColor(this.drawColor));
    const markerBtn = this.toolButtons.get("marker");
    markerBtn?.style.setProperty("--marker-tip-color", this.markerColor);
  }

  private syncAll(): void {
    this.syncPill();
    this.syncSwatch();
    this.syncThemeState();
    this.syncFollowerCard();
  }

  setToolsDisabled(disabled: boolean): void {
    if (disabled) {
      this.setTool("none");
    }
    for (const btn of this.toolButtons.values()) {
      btn.disabled = disabled;
    }
    this.undoBtn.disabled = disabled;
    this.redoBtn.disabled = disabled;
  }

  activateTextTool(): void {
    this.setTool("text");
  }

  /** 選んでいる道具を解除する（道具なしの状態へ戻す）。Escapeキー用。 */
  clearTool(): void {
    if (this.tool !== "none") this.setTool("none");
  }
}
