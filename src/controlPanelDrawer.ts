const DRAG_THRESHOLD_PX = 24;

/**
 * スマホ幅の下部バー: ツール選択は常時表示にし、色/消しゴムサイズと振り返り
 * シークバーは上部のハンドルをタップ/上下ドラッグすることで一行展開する
 * （ユーザー指示）。以前の縦スワイプ・scroll-snapによる3ページ切り替えは
 * 廃止した——シークバー（横ドラッグのrange input）がページ送り用の縦スワイプを
 * 奪ってしまい操作不能になる問題（issue #103）が、シークバーとページ送り
 * ジェスチャーの受け口を分ける必要のない構造そのものによって解消される。
 *
 * デスクトップ幅では.control-panel-bodyがdisplay:contentsになりハンドルも
 * 非表示になるため、このモジュールを常時呼び出しておいても実害はない。
 */
export function setupControlPanelDrawer(bodyEl: HTMLElement, handleEl: HTMLButtonElement): void {
  let expanded = false;
  let dragStartY: number | null = null;
  let dragHandled = false;

  const setExpanded = (next: boolean) => {
    expanded = next;
    bodyEl.dataset.expanded = String(expanded);
    handleEl.setAttribute("aria-expanded", String(expanded));
  };

  handleEl.addEventListener("pointerdown", (ev) => {
    dragStartY = ev.clientY;
    dragHandled = false;
  });

  handleEl.addEventListener("pointermove", (ev) => {
    if (dragStartY === null || dragHandled) return;
    const dy = ev.clientY - dragStartY;
    if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    dragHandled = true;
    setExpanded(dy < 0);
  });

  // ドラッグ量が閾値に届かなかった場合はタップとして扱い、開閉をトグルする。
  const endDrag = () => {
    if (dragStartY !== null && !dragHandled) setExpanded(!expanded);
    dragStartY = null;
  };
  handleEl.addEventListener("pointerup", endDrag);
  handleEl.addEventListener("pointercancel", () => {
    dragStartY = null;
  });
}
