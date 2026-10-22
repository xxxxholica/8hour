import "./style.css";
import { CircularCanvas } from "./canvasView";
import { MemoStore } from "./memoStore";
import {
  loadSheetStartedAt,
  loadThemePreference,
  saveSheetStartedAt,
  saveThemePreference,
  SHEET_DURATION_MS,
} from "./storage";
import { applyTheme, isDarkThemeActive } from "./theme";
import { Toolbar } from "./toolbar";

// テーマ（自動/ライト/ダーク）は、他の何よりも先に適用する
applyTheme(loadThemePreference());

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <div id="record-grid-trigger-slot" class="record-grid-trigger-card top-right-card"></div>
  </header>
  <main class="app-main">
    <div id="canvas-panel" class="view-panel">
      <div id="canvas-wrap" class="fade-visible is-visible"></div>
    </div>
  </main>
  <footer class="app-footer">
    <div id="active-tools-panel" class="control-panel">
      <div class="control-panel-body">
        <div id="primary-slot"></div>
      </div>
    </div>
    <button type="button" id="new-sheet-btn" class="new-sheet-btn" hidden>新しい紙を始める</button>
    <div id="panel-swatch-slot" class="panel-swatches"></div>
  </footer>
`;

let sheetStartedAt: number | null = loadSheetStartedAt();
let rewindAnim: { fromMs: number; startTime: number; durationMs: number } | null = null;

function formatTimerHMS(remainingMs: number): string {
  if (remainingMs >= SHEET_DURATION_MS) return "08:00:00";
  if (remainingMs <= 0) return "00:00:00";
  const totalSec = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getRemainingMs(now = Date.now()): number {
  if (sheetStartedAt === null) return SHEET_DURATION_MS;
  return Math.max(0, SHEET_DURATION_MS - (now - sheetStartedAt));
}

function startTimerRewind(fromMs: number): void {
  const clampedFrom = Math.max(0, Math.min(SHEET_DURATION_MS, fromMs));
  const elapsedSec = Math.ceil((SHEET_DURATION_MS - clampedFrom) / 1000);
  // 1秒以下の差（07:59:59 → 08:00:00）なら即座に08:00:00へ戻し、
  // canvasView側の文字ロールアニメーションで巻き戻りを表現する。
  if (elapsedSec <= 1) {
    rewindAnim = null;
    return;
  }
  const durationMs = Math.min(820, 220 + Math.log2(elapsedSec) * 85);
  rewindAnim = {
    fromMs: clampedFrom,
    startTime: performance.now(),
    durationMs,
  };
}

function getDisplayedTimerText(): string {
  if (sheetStartedAt !== null) {
    rewindAnim = null;
    return formatTimerHMS(getRemainingMs());
  }
  if (rewindAnim !== null) {
    const t = Math.min(1, Math.max(0, (performance.now() - rewindAnim.startTime) / rewindAnim.durationMs));
    if (t >= 1) {
      rewindAnim = null;
      return "08:00:00";
    }
    const eased = 1 - Math.pow(1 - t, 3);
    const fromSec = Math.floor(rewindAnim.fromMs / 1000);
    const targetSec = Math.floor(SHEET_DURATION_MS / 1000);
    const stepSec = Math.max(1, Math.ceil((targetSec - fromSec) * eased));
    const currentSec = Math.min(targetSec, fromSec + stepSec);
    return formatTimerHMS(currentSec * 1000);
  }
  return "08:00:00";
}

const store = new MemoStore((memos) => {
  const activeCount = memos.filter((m) => m.status === "active").length;
  if (activeCount > 0 && sheetStartedAt === null) {
    rewindAnim = null;
    sheetStartedAt = Date.now();
    saveSheetStartedAt(sheetStartedAt);
  } else if (activeCount === 0 && sheetStartedAt !== null) {
    startTimerRewind(getRemainingMs());
    sheetStartedAt = null;
    saveSheetStartedAt(null);
  }
});

// 起動時の整合性調整：白紙ならタイマー待機、既存メモがあって開始時刻が未保存なら最古のメモから復元する
const initialActive = store.getActive();
if (initialActive.length === 0) {
  if (sheetStartedAt !== null) {
    sheetStartedAt = null;
    saveSheetStartedAt(null);
  }
} else if (sheetStartedAt === null) {
  sheetStartedAt = Math.min(...initialActive.map((m) => m.createdAt));
  saveSheetStartedAt(sheetStartedAt);
}

const canvasWrap = document.querySelector<HTMLDivElement>("#canvas-wrap")!;
const primarySlot = document.querySelector<HTMLDivElement>("#primary-slot")!;
const activeToolsPanel = document.querySelector<HTMLDivElement>("#active-tools-panel")!;
const newSheetBtn = document.querySelector<HTMLButtonElement>("#new-sheet-btn")!;
const colorSwatchSlot = document.querySelector<HTMLDivElement>("#panel-swatch-slot")!;
const recordGridTriggerSlot = document.querySelector<HTMLDivElement>("#record-grid-trigger-slot")!;

const onToolChange = () => {
  canvasView.closeWritingSession();
  canvasView.finishTextEditingIfOpen();
};

const toolbar = new Toolbar(
  primarySlot,
  colorSwatchSlot,
  onToolChange,
  () => canvasView.undo(),
  {
    container: recordGridTriggerSlot,
    onToggleDarkMode: () => {
      const nextPref = isDarkThemeActive() ? "light" : "dark";
      saveThemePreference(nextPref);
      applyTheme(nextPref);
    },
  }
);

window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  toolbar.syncThemeState();
});

const getToolState = () => ({
  tool: toolbar.getTool(),
  color: toolbar.getColor(),
  fontSize: toolbar.getFontSize(),
  lineWidth: toolbar.getLineWidth(),
  eraserRadius: toolbar.getEraserRadius(),
});

const canvasView = new CircularCanvas(canvasWrap, store, getToolState, {
  fixedBottomTextEditorOnCoarsePointer: false,
  onAutoTextToolStart: () => toolbar.activateTextTool(),
  getBackgroundTimerText: () => getDisplayedTimerText(),
});

let sheetLocked = false;
function syncSheetLockState(): void {
  const expired = sheetStartedAt !== null && getRemainingMs() <= 0;
  if (expired === sheetLocked) return;
  sheetLocked = expired;
  canvasView.setLocked(expired);
  toolbar.setToolsDisabled(expired);
  activeToolsPanel.hidden = expired;
  newSheetBtn.hidden = !expired;
}

newSheetBtn.addEventListener("click", () => {
  startTimerRewind(getRemainingMs());
  store.replaceAll([]);
  sheetStartedAt = null;
  saveSheetStartedAt(null);
  syncSheetLockState();
});

syncSheetLockState();

function frame(): void {
  syncSheetLockState();
  canvasView.render();
  const zoomed = canvasView.isZoomed();
  const mobileTextEditing = canvasView.isEditingTextFixedBottom();
  app.classList.toggle("is-zoomed", zoomed);
  app.classList.toggle("is-editing-text-mobile", mobileTextEditing);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
