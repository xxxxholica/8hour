/**
 * 共同アイデア出しセッションのフェーズが切り替わった瞬間に、格闘ゲーム風の
 * 帯+フラッシュで一瞬だけフェーズ名を大きく見せる「カットイン」演出
 * （issue #79、ユーザー指示：ゲーム的な要素として各フェーズの切り替わりを
 * 「アイデア出し開始」のように演出したい）。呼び出し元(smuiView.ts)は
 * フェーズが実際に変わった時だけこれを呼べばよく、見た目の使い捨てDOM生成・
 * 後片付けはここに閉じている。
 */

let activeCleanup: (() => void) | null = null;

/** アニメーション全体の長さより長めに確保した保険。何らかの理由で
 *  animationendが発火しない環境（prefers-reduced-motion等）でも、
 *  ここで確実にDOMを片付ける。 */
const FALLBACK_CLEANUP_MS = 1700;

export function showPhaseCutIn(text: string): void {
  // 短時間に連続で呼ばれた場合（フェーズが素早く進んだ等）、前の演出は
  // 完了を待たず即座に片付けて新しい方だけを見せる。
  activeCleanup?.();

  const overlay = document.createElement("div");
  overlay.className = "phase-cutin";
  overlay.setAttribute("aria-hidden", "true");

  const flash = document.createElement("div");
  flash.className = "phase-cutin-flash";
  overlay.appendChild(flash);

  const band = document.createElement("div");
  band.className = "phase-cutin-band";
  const label = document.createElement("span");
  label.className = "phase-cutin-text";
  label.textContent = text;
  band.appendChild(label);
  overlay.appendChild(band);

  document.body.appendChild(overlay);

  const fallbackTimer = window.setTimeout(cleanup, FALLBACK_CLEANUP_MS);
  function cleanup(): void {
    window.clearTimeout(fallbackTimer);
    overlay.remove();
    if (activeCleanup === cleanup) activeCleanup = null;
  }
  activeCleanup = cleanup;
  band.addEventListener("animationend", cleanup, { once: true });
}
