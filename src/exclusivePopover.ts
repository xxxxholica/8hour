/**
 * ルーム作成・選択メニューと見た目の設定メニューなど、同じ場所（眼鏡キャンバス
 * の下）に並ぶ複数のポップアップは、同時に開いていると窮屈で分かりにくい
 * （ユーザー指摘）。どちらかを開いている時にもう一方を開こうとしたら、
 * 先に開いていた方を自動で閉じる——各メニュークラスは自分の閉じる関数と
 * 自分のicon-anchor要素を、開く直前にnotifyOpen()へ渡すだけでよい。
 *
 * 加えて、開いている間に自分（トリガーボタン・ポップオーバーの中身を含む
 * icon-anchor）の外側をクリック／タップしたら自動で閉じる（ユーザー指示）。
 * 各メニュークラス側でoutside-click用のリスナーを個別に持たせず、ここに
 * 1本化する——同時に開けるポップオーバーは常に高々1つ（上のnotifyOpenの
 * 排他制御）なので、直近に開かれたactiveAnchorだけを見れば足りる。
 */
let activeClose: (() => void) | null = null;
let activeAnchor: HTMLElement | null = null;

export function notifyOpen(close: () => void, anchor: HTMLElement): void {
  if (activeClose && activeClose !== close) activeClose();
  activeClose = close;
  activeAnchor = anchor;
}

export function notifyClose(close: () => void): void {
  if (activeClose === close) {
    activeClose = null;
    activeAnchor = null;
  }
}

// pointerdownで拾う（clickより先に発火するため、開いた直後の同じクリックで
// 即座に閉じてしまう心配がない——その時点ではまだactiveCloseがnullか、
// トリガーボタン自身がactiveAnchorの内側にあるため、どちらのケースも
// 下のcontainsチェックで自然に無視される）。
document.addEventListener("pointerdown", (ev) => {
  if (!activeClose || !activeAnchor) return;
  if (ev.target instanceof Node && activeAnchor.contains(ev.target)) return;
  activeClose();
});
