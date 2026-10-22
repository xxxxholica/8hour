import { DEFAULT_FONT_SIZE_STEP, FONT_SIZE_STEPS, LINE_HEIGHT_MULTIPLIER, normalizedBoxSize } from "./textLayout";
import { DEFAULT_LIGHT_INK } from "./theme";
import type { DrawTool, Memo, Point, Stroke, StrokeMemo, TextMemo } from "./types";

const STORAGE_KEY = "memos";
const THEME_KEY = "themePreference";
const SHEET_STARTED_AT_KEY = "sheetStartedAt";
const DEFAULT_TOOL: DrawTool = "pen";

/** 1枚の紙の制限時間（8時間 = 1日の稼働時間）。 */
export const SHEET_DURATION_MS = 8 * 60 * 60 * 1000;

/** "system"はOSのprefers-color-schemeに従う（既定）。"light"/"dark"はツールバーの
 *  ダークモード切替ボタンで明示的に固定した状態。 */
export type ThemePreference = "system" | "light" | "dark";
const DEFAULT_THEME: ThemePreference = "system";
const VALID_THEMES = new Set<ThemePreference>(["system", "light", "dark"]);

const SAFE_CSS_COLOR_RE =
  /^(?:#[0-9a-fA-F]{3,8}|oklch\(\s*-?\d+(?:\.\d+)?%\s+-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?%?)?\s*\))$/;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeCssColor(value: unknown): value is string {
  return typeof value === "string" && SAFE_CSS_COLOR_RE.test(value);
}

function isPointShaped(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

function isStrokeArrayShaped(value: unknown): value is Stroke[] {
  return (
    Array.isArray(value) &&
    value.every((stroke) => Array.isArray(stroke) && stroke.every(isPointShaped))
  );
}

function isMemoShaped(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  const baseOk =
    typeof m.id === "string" &&
    m.id.length > 0 &&
    isFiniteNumber(m.x) &&
    isFiniteNumber(m.y) &&
    isFiniteNumber(m.createdAt) &&
    (m.status === "active" || m.status === "faded");
  if (!baseOk) return false;

  if (m.kind === "text") return typeof m.text === "string";
  // kindが無い場合（テキスト機能追加前の古いデータ）も含め、手描きメモとして扱う
  return isStrokeArrayShaped(m.strokes);
}

/**
 * 古い形式のデータ（道具・色・kindを持たない）を補い、現在の形式に揃える。
 */
function migrate(raw: Record<string, unknown>): Memo {
  const base: {
    id: string;
    x: number;
    y: number;
    createdAt: number;
    status: Memo["status"];
    color: string;
    originHalfW?: number;
    originHalfH?: number;
  } = {
    id: raw.id as string,
    x: raw.x as number,
    y: raw.y as number,
    createdAt: raw.createdAt as number,
    status: raw.status as Memo["status"],
    color: isSafeCssColor(raw.color) ? raw.color : DEFAULT_LIGHT_INK,
  };
  if (isFiniteNumber(raw.originHalfW) && raw.originHalfW > 0) {
    base.originHalfW = raw.originHalfW;
  }
  if (isFiniteNumber(raw.originHalfH) && raw.originHalfH > 0) {
    base.originHalfH = raw.originHalfH;
  }

  if (raw.kind === "text") {
    const text = typeof raw.text === "string" ? raw.text : "";
    const fontSize =
      isFiniteNumber(raw.fontSize) && raw.fontSize > 0
        ? raw.fontSize
        : FONT_SIZE_STEPS[DEFAULT_FONT_SIZE_STEP];
    const hasValidLines =
      Array.isArray(raw.textLines) && raw.textLines.every((l) => typeof l === "string");
    const textLines = hasValidLines ? (raw.textLines as string[]) : [text];
    const fallbackBox = normalizedBoxSize(fontSize, textLines.length);
    const textMemo: TextMemo = {
      ...base,
      kind: "text",
      text,
      textLines,
      fontSize,
      boxWidth: isFiniteNumber(raw.boxWidth) && raw.boxWidth > 0 ? raw.boxWidth : fallbackBox.width,
      boxHeight: isFiniteNumber(raw.boxHeight) && raw.boxHeight > 0 ? raw.boxHeight : fallbackBox.height,
      align: raw.align === "left" ? "left" : "center",
      lineHeight: isFiniteNumber(raw.lineHeight) && raw.lineHeight > 0 ? raw.lineHeight : LINE_HEIGHT_MULTIPLIER,
    };
    return textMemo;
  }

  const strokeMemo: StrokeMemo = {
    ...base,
    kind: "stroke",
    strokes: (raw.strokes as Stroke[]).map((s) => s.map((p) => ({ x: p.x, y: p.y }))),
    tool: raw.tool === "marker" ? "marker" : DEFAULT_TOOL,
    lineWidth: isFiniteNumber(raw.lineWidth) && raw.lineWidth > 0 ? raw.lineWidth : undefined,
  };
  return strokeMemo;
}

export function loadMemos(): Memo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMemoShaped).map(migrate);
  } catch {
    // 壊れたデータは復元不能として扱い、空から始める（例外は投げない）
    return [];
  }
}

export function saveMemos(memos: Memo[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memos));
  } catch {
    // プライベートブラウジングや容量上限超過時は例外を握りつぶし描画操作を継続させる
  }
}

/** ツールバーのダークモード切替で使う外観設定（自動/ライト/ダーク）。
 *  既定は"system"——OSの設定に従う。 */
export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw !== null && VALID_THEMES.has(raw as ThemePreference) ? (raw as ThemePreference) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // ignore storage errors
  }
}

export function loadSheetStartedAt(): number | null {
  try {
    const raw = localStorage.getItem(SHEET_STARTED_AT_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveSheetStartedAt(startedAt: number | null): void {
  try {
    if (startedAt === null) {
      localStorage.removeItem(SHEET_STARTED_AT_KEY);
    } else {
      localStorage.setItem(SHEET_STARTED_AT_KEY, String(startedAt));
    }
  } catch {
    // ignore storage errors
  }
}
