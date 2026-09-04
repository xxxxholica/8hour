import { createFadeVisibility } from "./fadeVisibility";
import { renderMemoThumbnail } from "./memoRenderer";
import { listArchivedDateKeys, loadArchive } from "./storage";

/**
 * 記録一覧画面：書き込みのあった日（archive:<日付>キーが存在する日）だけを、
 * 日付＋ミニサムネイルのグリッドで一覧表示する専用の全画面オーバーレイ。
 *
 * 円相は「一覧・検索UIを持たない」を原則としているが、この画面はその明示的な
 * 例外として扱う（ユーザー指示）。以前は設定メニューの中に縦一覧として実装して
 * いたが、メニューがごちゃついたため撤廃した経緯があり、同じ轍を踏まないよう
 * 設定メニュー・日付めくり画面（main.ts #history-strip/#history-view）とは
 * 完全に独立した全画面オーバーレイにする——骨格・シングルトンで使い回す構成・
 * フォーカスの作法はusageGuide.tsに揃える。
 *
 * グリッドは索引役に徹し、実際の閲覧・ドラッグでの持ち出しは既存の日付めくり
 * 画面に一本化する（ユーザー指示）。セルをタップしても、その場でプレビューや
 * 操作をさせるのではなく、onSelectDateで日付だけを呼び出し側（main.ts）に
 * 渡してこの画面自身は閉じる——その日を実際に開く処理（setHistoryOffset）は
 * 呼び出し側が持つ。
 */

/** サムネイル1マスの一辺（CSSピクセル）。日付めくり画面より一度に多くの
 *  サムネイルが並ぶ想定のため、小さめの固定値にする（実際の見た目の大きさは
 *  style.css .record-grid-thumb側のCSS指定に合わせておくこと）。 */
const THUMBNAIL_SIZE_PX = 96;

let overlay: RecordGrid | null = null;

/** onSelectDateは、セルをタップして画面を閉じた直後に一度だけ、選ばれた
 *  日付キー（"YYYY-MM-DD"）を渡して呼ばれる。 */
export function openRecordGrid(onSelectDate: (dateKey: string) => void): void {
  if (!overlay) overlay = new RecordGrid();
  overlay.open(onSelectDate);
}

class RecordGrid {
  private root: HTMLElement;
  private sheet: HTMLElement;
  private grid: HTMLElement;
  private emptyState: HTMLElement;
  private setVisible: (show: boolean) => void;
  private opened = false;
  private lastFocused: HTMLElement | null = null;
  private onSelectDate: ((dateKey: string) => void) | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "record-grid fade-visible";
    this.root.hidden = true;
    // usageGuide.tsと同じく、背景の帯自体（.rootとの一致判定）をクリックした
    // 場合だけ閉じる——中身（シート・グリッド）へのクリックは巻き込まない。
    this.root.addEventListener("pointerdown", (ev) => {
      if (ev.target === this.root) this.close();
    });

    this.sheet = document.createElement("section");
    this.sheet.className = "record-grid-sheet";
    this.sheet.setAttribute("role", "dialog");
    this.sheet.setAttribute("aria-modal", "true");
    this.sheet.setAttribute("aria-label", "過去の記録");
    this.sheet.tabIndex = -1;
    this.root.appendChild(this.sheet);

    const head = document.createElement("header");
    head.className = "record-grid-head";
    const title = document.createElement("h2");
    title.className = "record-grid-title";
    title.textContent = "過去の記録";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "record-grid-close";
    closeBtn.setAttribute("aria-label", "閉じる");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.close());
    head.append(title, closeBtn);
    this.sheet.appendChild(head);

    this.emptyState = document.createElement("p");
    this.emptyState.className = "record-grid-empty";
    this.emptyState.textContent = "まだ記録がありません";
    this.emptyState.hidden = true;
    this.sheet.appendChild(this.emptyState);

    this.grid = document.createElement("div");
    this.grid.className = "record-grid-cells";
    this.sheet.appendChild(this.grid);

    this.setVisible = createFadeVisibility(this.root);
    document.body.appendChild(this.root);
  }

  /** 開くたびに作り直す（アーカイブの中身は前回開いた時から増えている
   *  可能性があるため、DOMを使い回さず毎回組み立て直す）。並び順は新しい日が
   *  先（ユーザー指示）——日付キーは"YYYY-MM-DD"形式のため文字列の降順で
   *  そのまま新しい順になる。 */
  private buildCells(): void {
    this.grid.innerHTML = "";
    const dateKeys = listArchivedDateKeys().sort((a, b) => b.localeCompare(a));
    this.emptyState.hidden = dateKeys.length > 0;
    this.grid.hidden = dateKeys.length === 0;
    for (const dateKey of dateKeys) {
      this.grid.appendChild(this.buildCell(dateKey));
    }
  }

  /** グリッドは索引役に徹する（ユーザー指示）——セル自体はドラッグ・
   *  プレビュー等の操作を一切持たず、タップすると日付めくり画面のその日へ
   *  遷移する（onSelectDate）だけの単純なボタン。 */
  private buildCell(dateKey: string): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "record-grid-cell";
    btn.setAttribute("aria-label", formatCellDateLabel(dateKey));
    btn.addEventListener("click", () => {
      const onSelectDate = this.onSelectDate;
      this.close();
      onSelectDate?.(dateKey);
    });

    const canvas = document.createElement("canvas");
    canvas.className = "record-grid-thumb";
    btn.appendChild(canvas);
    renderMemoThumbnail(canvas, loadArchive(dateKey), THUMBNAIL_SIZE_PX);

    const label = document.createElement("span");
    label.className = "record-grid-cell-label";
    label.textContent = formatCellDateLabel(dateKey);
    btn.appendChild(label);

    return btn;
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    ev.stopPropagation();
    if (ev.key === "Escape") this.close();
  };

  open(onSelectDate: (dateKey: string) => void): void {
    if (this.opened) return;
    this.opened = true;
    this.onSelectDate = onSelectDate;
    this.buildCells();
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.setVisible(true);
    window.addEventListener("keydown", this.onKeyDown, true);
    requestAnimationFrame(() => this.sheet.focus());
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.setVisible(false);
    this.lastFocused?.focus();
    this.lastFocused = null;
  }
}

function formatCellDateLabel(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${m}月${d}日`;
}
