/** 見せ消し用アニメーション時間。各要素の.is-visible用CSSトランジション（例:
 *  .fade-visible, .icon-popover）と長さを揃えてある。 */
export const FADE_TRANSITION_MS = 180;

/**
 * 「出たり消えたりする要素」の表示・非表示をアニメーションさせる関数を作る。
 * 表示するときはhidden属性を外してから1フレーム分ブラウザに確定させ、
 * .is-visibleクラスを足してフェードイン。隠すときは.is-visibleを外して
 * フェードアウトさせてから、トランジションが終わるのを待ってhidden属性を
 * 戻す（アンマウント）。マウント/アンマウントをアニメーションさせるための定番の
 * 手順で、要素ごとに専用のタイマーをクロージャで持つため、複数の要素に使っても
 * 互いに干渉しない。
 *
 * テンプレートのポップアップメニュー（toolbar.ts）や、下部バーの中身の
 * クロスフェード（main.ts）など、複数箇所で同じ仕組みが必要になったため
 * 共通化した。
 */
export function createFadeVisibility(el: HTMLElement): (show: boolean) => void {
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  return (show: boolean) => {
    clearTimeout(hideTimer);
    if (show) {
      el.hidden = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add("is-visible"));
      });
    } else {
      el.classList.remove("is-visible");
      hideTimer = setTimeout(() => {
        el.hidden = true;
      }, FADE_TRANSITION_MS);
    }
  };
}
