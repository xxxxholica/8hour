import type { ThemePreference } from "./storage";

export const DEFAULT_LIGHT_INK = "oklch(22% 0.012 55)";
export const DEFAULT_DARK_INK = "oklch(92% 0.006 75)";

/**
 * 外観の指定をhtml要素のdata-theme属性に反映する。light/darkの色トークンは
 * style.cssの:root[data-theme="dark"]・@media(prefers-color-scheme: dark)側で
 * 定義されており、このモジュールは属性の切り替えとダークモード判定を担う。
 * "system"はdata-theme属性を外し、OSのprefers-color-schemeに従わせる。
 */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (pref === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = pref;
  }
}

/** 現在ダークモードで表示されているか。data-theme="dark"を明示的に選んでいる
 *  場合はもちろん、"system"（属性なし）でOS側がダーク設定の場合も含める。 */
export function isDarkThemeActive(): boolean {
  if (typeof document === "undefined") return false;
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
}

/** 既定の黒インク（DEFAULT_LIGHT_INK等）で書かれた線・文字を、ダークモード時には
 *  白系インクへ自動変換して暗い紙の上でも視認性を保つ。赤・青・マーカー等の
 *  有彩色はどちらのモードでもそのままの色で描画する。 */
export function resolveInkColor(color: string, dark: boolean = isDarkThemeActive()): string {
  if (!dark) return color;
  if (color === DEFAULT_LIGHT_INK || color === "#2f2a26" || color === "#000000" || color === "#000") {
    return DEFAULT_DARK_INK;
  }
  return color;
}
