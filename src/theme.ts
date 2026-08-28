import type { ThemePreference } from "./storage";

/**
 * テーマの指定をhtml要素のdata-theme属性に反映する。system/light/darkの色
 * トークンは固定値のため、切り替え自体はstyle.cssの:root[data-theme="dark"]・
 * @media(prefers-color-scheme: dark)側で行う（このファイルはCSSに渡す属性を
 * 更新するだけで、色の値そのものは持たない）。"system"はdata-theme属性を外す
 * ——style.css側の@media(prefers-color-scheme)がOSの設定に従って自動で切り替わる。
 *
 * "custom"（好きな色を選ぶ、issue #138）はこれとは別で、色相からパステルな
 * 配色一式を導き出す必要があるため、CSSの固定値では表現できない——
 * buildPastelThemeVars()でink-* や paper-*等をその場で計算し、:rootへ
 * inline styleとして直接設定する。settingsMenu.tsのカラーパレットはRGB値を
 * 直接扱わない横1本の色相スライダー（Chromeのテーマ設定と同じ見た目、ユーザー
 * 指示）のため、ここで受け取るのも0〜360度の数値のみで、色そのもの（#rrggbb等）
 * は一切経由しない。
 */
export function applyTheme(pref: ThemePreference, customHue?: number): void {
  const root = document.documentElement;
  if (pref === "custom") {
    applyPastelThemeVars(customHue ?? CUSTOM_HUE_FALLBACK);
    root.dataset.theme = pref;
    return;
  }
  clearPastelThemeVars();
  if (pref === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = pref;
  }
}

/** 現在ダーク配色で表示されているか。data-theme="dark"を明示的に選んでいる
 *  場合はもちろん、"system"（属性なし）でOS側がダーク設定の場合も含める
 *  ——frameGeometry.tsの片眼鏡チェーンのように「暗い紙の背景の上でも見える
 *  色を選びたい」用途では、選び方によらず実際にダーク表示かどうかが重要な
 *  ため（ユーザー指示：黒テーマの時だけ紐の色を変えたい）。custom（好きな色）
 *  はレシピ上常にパステルな明るい配色のため対象外。 */
export function isDarkThemeActive(): boolean {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "dark") return true;
  if (explicit === "light" || explicit === "custom") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** customHueが未指定の場合の色相フォールバック（OKLCH、度）。storage.tsの
 *  DEFAULT_CUSTOM_THEME_HUEと揃えてある（水色寄り）。 */
const CUSTOM_HUE_FALLBACK = 220;

/** パステルテーマ(custom)で使うink-* / paper-* / rule-lineのCSSカスタム
 *  プロパティ名一覧。適用時はここに値を設定し、他のテーマへ切り替える時は
 *  ここを:root上から取り除く（inline styleはスタイルシートの値より常に優先
 *  されてしまうため、消し忘れると他のテーマにまで色が残ってしまう）。 */
const PASTEL_PROPERTY_NAMES = [
  "--ink-solid",
  "--ink-95",
  "--ink-85",
  "--ink-80",
  "--ink-70",
  "--ink-60",
  "--ink-55",
  "--ink-50",
  "--ink-45",
  "--ink-40",
  "--ink-35",
  "--ink-20",
  "--ink-12",
  "--ink-08",
  "--ink-06",
  "--paper-0",
  "--paper-1",
  "--paper-2",
  "--paper-2-hover",
  "--paper-3",
  "--paper-4",
  "--rule-line",
] as const;

/** 指定した色相(hue、OKLCH度)から、light/darkと同じ「インク1色＋紙の明度違い」
 *  の構造を保ったまま、Chromeのカスタムテーマのようなパステルな配色一式を
 *  機械的に導き出す。彩度・明度は固定のレシピで決め、色相だけを可変にする
 *  ——ユーザーがどの色相を選んでも、極端に濃い/薄い配色にならないようにするため。 */
function buildPastelThemeVars(hue: number): Record<(typeof PASTEL_PROPERTY_NAMES)[number], string> {
  const ink = (alpha?: number) => `oklch(30% 0.03 ${hue}${alpha !== undefined ? ` / ${alpha}` : ""})`;
  return {
    "--ink-solid": ink(),
    "--ink-95": ink(0.95),
    "--ink-85": ink(0.85),
    "--ink-80": ink(0.8),
    "--ink-70": ink(0.7),
    "--ink-60": ink(0.6),
    "--ink-55": ink(0.55),
    "--ink-50": ink(0.5),
    "--ink-45": ink(0.45),
    "--ink-40": ink(0.4),
    "--ink-35": ink(0.35),
    "--ink-20": ink(0.2),
    "--ink-12": ink(0.12),
    "--ink-08": ink(0.08),
    "--ink-06": ink(0.06),
    "--paper-0": `oklch(95% 0.02 ${hue})`,
    "--paper-1": `oklch(97% 0.015 ${hue})`,
    "--paper-2": `oklch(90% 0.025 ${hue})`,
    "--paper-2-hover": `oklch(90% 0.03 ${hue})`,
    "--paper-3": `oklch(85% 0.03 ${hue})`,
    "--paper-4": `oklch(86% 0.03 ${hue})`,
    "--rule-line": `oklch(70% 0.06 ${hue} / 0.4)`,
  };
}

function applyPastelThemeVars(hue: number): void {
  const vars = buildPastelThemeVars(hue);
  for (const name of PASTEL_PROPERTY_NAMES) {
    document.documentElement.style.setProperty(name, vars[name]);
  }
}

function clearPastelThemeVars(): void {
  for (const name of PASTEL_PROPERTY_NAMES) {
    document.documentElement.style.removeProperty(name);
  }
}
