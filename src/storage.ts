import { DEFAULT_FRAME_PATTERN_ID } from "./framePattern";
import type { FramePatternId } from "./framePattern";
import { DEFAULT_FRAME_SHAPE_ID } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import { DEFAULT_FONT_SIZE_STEP, FONT_SIZE_STEPS, LINE_HEIGHT_MULTIPLIER, normalizedBoxSize } from "./textLayout";
import type { TemplateDef } from "./templates";
import type { DrawTool, Memo, StrokeMemo, TextMemo } from "./types";

const STORAGE_KEY = "memos";
const FRAME_SHAPE_KEY = "smuiFrameShape";
const FRAME_PATTERN_KEY = "smuiFramePattern";
const PERSONAL_FRAME_PATTERN_KEY = "personalFramePattern";
const CUSTOM_TEMPLATES_KEY = "customTemplates";
const USAGE_GUIDE_SEEN_KEY = "usageGuideSeen";
const THEME_KEY = "themePreference";
const DEFAULT_TOOL: DrawTool = "pen";
const DEFAULT_COLOR = "oklch(22% 0.012 55)";
const VALID_FRAME_SHAPES = new Set<FrameShapeId>(["round", "oval", "square"]);
const VALID_FRAME_PATTERNS = new Set<FramePatternId>(["matte", "tortoiseshell", "clear", "wood"]);
/** "system"はOSのprefers-color-schemeに従う（既定）。"light"/"dark"は明示的に固定。
 *  "custom"（好きな色を選ぶ、issue #138）はOSに存在しないパステルテーマの
 *  ため、"system"では選ばれず、明示的に選んだ時だけ固定される——色トークンの
 *  計算はtheme.ts参照。実際の色相はthemePreference自体ではなく
 *  CUSTOM_THEME_HUE_KEY（下記）に別途持つ。 */
export type ThemePreference = "system" | "light" | "dark" | "custom";
const DEFAULT_THEME: ThemePreference = "system";
const VALID_THEMES = new Set<ThemePreference>(["system", "light", "dark", "custom"]);
const CUSTOM_THEME_HUE_KEY = "customThemeHue";
/** カラーパレット（Chromeのテーマ設定のような横バー1本の色相スライダー、
 *  issue #138）をまだ一度も操作していない状態での初期値（水色寄り）。RGB値を
 *  直接扱わず、OKLCHの色相(0〜360度)だけを保持する——このアプリのパステル
 *  配色は色相だけから機械的に導き出すため(theme.tsのbuildPastelThemeVars
 *  参照)、明度・彩度まで保持する必要が無い。 */
const DEFAULT_CUSTOM_THEME_HUE = 220;

function isMemoShaped(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  const baseOk =
    typeof m.id === "string" &&
    typeof m.x === "number" &&
    typeof m.y === "number" &&
    typeof m.createdAt === "number" &&
    typeof m.lastTracedAt === "number" &&
    (m.lifespanDays === null || typeof m.lifespanDays === "number") &&
    (m.status === "active" || m.status === "faded");
  if (!baseOk) return false;

  if (m.kind === "text") return typeof m.text === "string";
  // kindが無い場合（テキスト機能追加前の古いデータ）も含め、手描きメモとして扱う
  return Array.isArray(m.strokes);
}

/**
 * 古い形式のデータ（道具・色・なぞり履歴・kindを持たない）を補い、現在の形式に揃える。
 * traceHistoryが無い場合はcreatedAt/lastTracedAtから最善の推測で組み立てる
 * （複数回なぞり直した履歴までは復元できないが、破綻はしない）。
 */
function migrate(raw: Record<string, unknown>): Memo {
  const createdAt = raw.createdAt as number;
  const lastTracedAt = raw.lastTracedAt as number;
  const hasValidTraceHistory =
    Array.isArray(raw.traceHistory) && raw.traceHistory.every((n) => typeof n === "number");
  const traceHistory = hasValidTraceHistory
    ? (raw.traceHistory as number[])
    : lastTracedAt !== createdAt
      ? [createdAt, lastTracedAt]
      : [createdAt];

  const base = {
    id: raw.id as string,
    x: raw.x as number,
    y: raw.y as number,
    createdAt,
    lastTracedAt,
    traceHistory,
    lifespanDays: raw.lifespanDays as Memo["lifespanDays"],
    status: raw.status as Memo["status"],
    color: typeof raw.color === "string" ? raw.color : DEFAULT_COLOR,
  };

  if (raw.kind === "text") {
    const text = typeof raw.text === "string" ? raw.text : "";
    const fontSize =
      typeof raw.fontSize === "number" ? raw.fontSize : FONT_SIZE_STEPS[DEFAULT_FONT_SIZE_STEP];
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
      boxWidth: typeof raw.boxWidth === "number" ? raw.boxWidth : fallbackBox.width,
      boxHeight: typeof raw.boxHeight === "number" ? raw.boxHeight : fallbackBox.height,
      align: raw.align === "left" ? "left" : "center",
      lineHeight: typeof raw.lineHeight === "number" ? raw.lineHeight : LINE_HEIGHT_MULTIPLIER,
    };
    return textMemo;
  }

  const strokeMemo: StrokeMemo = {
    ...base,
    kind: "stroke",
    strokes: raw.strokes as StrokeMemo["strokes"],
    tool: typeof raw.tool === "string" ? (raw.tool as DrawTool) : DEFAULT_TOOL,
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memos));
}

/** SMUI（眼鏡デュアルビュー）で選んだフレーム形状（着せ替え）。 */
export function loadFrameShape(): FrameShapeId {
  try {
    const raw = localStorage.getItem(FRAME_SHAPE_KEY);
    return raw !== null && VALID_FRAME_SHAPES.has(raw as FrameShapeId)
      ? (raw as FrameShapeId)
      : DEFAULT_FRAME_SHAPE_ID;
  } catch {
    return DEFAULT_FRAME_SHAPE_ID;
  }
}

export function saveFrameShape(id: FrameShapeId): void {
  localStorage.setItem(FRAME_SHAPE_KEY, id);
}

/** 共有キャンバス（眼鏡形状）で選んだフレームの柄・質感（着せ替え）。 */
export function loadFramePattern(): FramePatternId {
  try {
    const raw = localStorage.getItem(FRAME_PATTERN_KEY);
    return raw !== null && VALID_FRAME_PATTERNS.has(raw as FramePatternId)
      ? (raw as FramePatternId)
      : DEFAULT_FRAME_PATTERN_ID;
  } catch {
    return DEFAULT_FRAME_PATTERN_ID;
  }
}

export function saveFramePattern(id: FramePatternId): void {
  localStorage.setItem(FRAME_PATTERN_KEY, id);
}

/** 個人キャンバスで選んだフレームの柄・質感(着せ替え)。共有キャンバス
 *  (loadFramePattern/saveFramePattern)とは別キーで持つ——サーバーに
 *  同期される共有ルームの見た目とは無関係な、この端末だけのローカル設定。 */
export function loadPersonalFramePattern(): FramePatternId {
  try {
    const raw = localStorage.getItem(PERSONAL_FRAME_PATTERN_KEY);
    return raw !== null && VALID_FRAME_PATTERNS.has(raw as FramePatternId)
      ? (raw as FramePatternId)
      : DEFAULT_FRAME_PATTERN_ID;
  } catch {
    return DEFAULT_FRAME_PATTERN_ID;
  }
}

export function savePersonalFramePattern(id: FramePatternId): void {
  localStorage.setItem(PERSONAL_FRAME_PATTERN_KEY, id);
}

/** 使い方ページ（円相の由来と基本操作を紹介する読み物）を、既に開いたことが
 *  あるか。個人キャンバスの案内ボタン（main.ts）が、未読の間だけ出しっぱなし
 *  にするために参照する。 */
export function loadUsageGuideSeen(): boolean {
  try {
    return localStorage.getItem(USAGE_GUIDE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markUsageGuideSeen(): void {
  localStorage.setItem(USAGE_GUIDE_SEEN_KEY, "1");
}

function isCustomTemplateShaped(value: unknown): value is TemplateDef {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.label === "string" &&
    typeof t.description === "string" &&
    typeof t.text === "string"
  );
}

/** ユーザーが全画面のテンプレート選択（templatePicker.ts）で作成したテンプレート。 */
export function loadCustomTemplates(): TemplateDef[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCustomTemplateShaped);
  } catch {
    return [];
  }
}

export function saveCustomTemplates(templates: TemplateDef[]): void {
  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates));
}

/** ヘッダーの「設定」ボタン（settingsMenu.ts）で選ぶテーマ（自動/ライト/ダーク）。
 *  既定は"system"——OSの設定に従う（ユーザー指示：設定ボタンを追加して
 *  テーマ変更機能を入れたい）。 */
export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw !== null && VALID_THEMES.has(raw as ThemePreference) ? (raw as ThemePreference) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveThemePreference(pref: ThemePreference): void {
  localStorage.setItem(THEME_KEY, pref);
}

/** テーマ「好きな色を選ぶ」（settingsMenu.tsのカラーパレット、issue #138）で
 *  最後に選んだ色相(OKLCH、0〜360度)。0〜360の有限な数値以外・未設定の間は
 *  DEFAULT_CUSTOM_THEME_HUEへフォールバックする。 */
export function loadCustomThemeHue(): number {
  try {
    const raw = localStorage.getItem(CUSTOM_THEME_HUE_KEY);
    const hue = raw !== null ? Number(raw) : NaN;
    return Number.isFinite(hue) && hue >= 0 && hue <= 360 ? hue : DEFAULT_CUSTOM_THEME_HUE;
  } catch {
    return DEFAULT_CUSTOM_THEME_HUE;
  }
}

export function saveCustomThemeHue(hue: number): void {
  localStorage.setItem(CUSTOM_THEME_HUE_KEY, String(hue));
}
