import { DEFAULT_FONT_SIZE_STEP, FONT_SIZE_STEPS, LINE_HEIGHT_MULTIPLIER, normalizedBoxSize } from "./textLayout";
import type { DrawTool, Memo, StrokeMemo, TextMemo } from "./types";

const STORAGE_KEY = "memos";
const ARCHIVE_KEY_PREFIX = "archive:";
const LAST_ACTIVE_DATE_KEY = "lastActiveDate";
const EXPORT_EVENTS_KEY = "exportEvents";
const ARCHIVE_EXPORT_FLAGS_KEY = "archiveExportFlags";
const FIRST_RESET_HINT_SHOWN_KEY = "firstResetHintShown";
const USAGE_GUIDE_SEEN_KEY = "usageGuideSeen";
const THEME_KEY = "themePreference";
const DEFAULT_TOOL: DrawTool = "pen";
const DEFAULT_COLOR = "oklch(22% 0.012 55)";
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
    (m.status === "active" || m.status === "faded");
  if (!baseOk) return false;

  if (m.kind === "text") return typeof m.text === "string";
  // kindが無い場合（テキスト機能追加前の古いデータ）も含め、手描きメモとして扱う
  return Array.isArray(m.strokes);
}

/**
 * 古い形式のデータ（道具・色・kindを持たない）を補い、現在の形式に揃える。
 * 経時フェード機能があった旧バージョンのlastTracedAt/traceHistory/lifespanDays
 * フィールドはJSON上に残っていても無視する（現在の型では扱わない）。
 */
function migrate(raw: Record<string, unknown>): Memo {
  const base = {
    id: raw.id as string,
    x: raw.x as number,
    y: raw.y as number,
    createdAt: raw.createdAt as number,
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
    lineWidth: typeof raw.lineWidth === "number" ? raw.lineWidth : undefined,
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

/** 朝リセット（dailyReset.ts）で退避した、日付キーごとのメモ一覧。memosキーと
 *  同じ形式（Memo[]のJSON）で、キーだけ`archive:<日付>`にして日付ごとに独立させる。
 *  読み込み時はmemosキーと同じmigrateを通す——アーカイブは無期限保持されるため、
 *  古い形式のデータが残っていても読めるようにする必要がある。 */
export function loadArchive(dateKey: string): Memo[] {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY_PREFIX + dateKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMemoShaped).map(migrate);
  } catch {
    return [];
  }
}

export function saveArchive(dateKey: string, memos: Memo[]): void {
  localStorage.setItem(ARCHIVE_KEY_PREFIX + dateKey, JSON.stringify(memos));
}

/** 書き込みのあった日（archive:<日付>キーが存在する日）の日付部分だけを
 *  全て返す（順不同、並び替えは呼び出し側の責任）。saveArchiveは中身が
 *  1件以上ある日にしか呼ばれない（dailyReset.ts）ため、ここで返す日付は
 *  すべて「その日何かを書いた日」に一致する——空判定を別途行う必要はない。
 *  記録一覧画面（recordGrid.ts）が、過去めくり画面と違い書き込みのあった日
 *  だけを一覧表示するために使う。 */
export function listArchivedDateKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(ARCHIVE_KEY_PREFIX)) {
        keys.push(key.slice(ARCHIVE_KEY_PREFIX.length));
      }
    }
    return keys;
  } catch {
    return [];
  }
}

/** 朝リセット（dailyReset.ts）が最後にキャンバスを見た暦日（"YYYY-MM-DD"）。
 *  この日付と当日の日付を比較して、変わっていればアーカイブへ退避する。
 *  未設定（この機能を初めて読み込む既存ユーザー）の間はnull。 */
export function loadLastActiveDate(): string | null {
  try {
    return localStorage.getItem(LAST_ACTIVE_DATE_KEY);
  } catch {
    return null;
  }
}

export function saveLastActiveDate(dateKey: string): void {
  localStorage.setItem(LAST_ACTIVE_DATE_KEY, dateKey);
}

/** コアループの利用実態の計測（E8-06）用の、書き出し操作の履歴1件。 */
export interface ExportEvent {
  timestamp: number;
  kind: "image" | "text";
}

/** エクスポート操作（設定メニューのPNG/TXTボタン、exportControl.ts）のイベントログ。
 *  ダッシュボード等は持たず、後からlocalStorageの中身を直接見て集計する前提。 */
export function loadExportEvents(): ExportEvent[] {
  try {
    const raw = localStorage.getItem(EXPORT_EVENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExportEvent[]) : [];
  } catch {
    return [];
  }
}

export function appendExportEvent(event: ExportEvent): void {
  const events = loadExportEvents();
  events.push(event);
  localStorage.setItem(EXPORT_EVENTS_KEY, JSON.stringify(events));
}

/** 朝リセットでアーカイブした日付ごとに、その日のうちに一度でもエクスポートが
 *  使われていたか（E8-06）。アーカイブを作らなかった日（空のキャンバスのまま
 *  日付が変わった日）はキーごと記録しない——dailyReset.ts参照。 */
export function loadArchiveExportFlags(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(ARCHIVE_EXPORT_FLAGS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function markArchiveExportFlag(dateKey: string, exported: boolean): void {
  const flags = loadArchiveExportFlags();
  flags[dateKey] = exported;
  localStorage.setItem(ARCHIVE_EXPORT_FLAGS_KEY, JSON.stringify(flags));
}

/** 「指定しなかったメモはサイレント保存されています」という一言ヒント（E2-14）を、
 *  初回の朝リセット時に既に見せたか。以後は二度と出さないためのフラグ。 */
export function loadFirstResetHintShown(): boolean {
  try {
    return localStorage.getItem(FIRST_RESET_HINT_SHOWN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markFirstResetHintShown(): void {
  localStorage.setItem(FIRST_RESET_HINT_SHOWN_KEY, "1");
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
