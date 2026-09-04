import { CANVAS_FRAME_SHAPE } from "./frameShape";
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
 *
 * 窓（.record-grid-sheet）の大きさ・形は記録の件数に関わらず常に一定にする
 * （ユーザー指示）——1ページあたりのマス数を画面幅で固定（デスクトップ3×3=9、
 * モバイル2×2=4）にし、実データがそのページの枠数に満たない場合は残りを
 * ダミーセル（空状態と同じ、薄い輪郭線だけの角丸正方形）で埋める。枠数を
 * 超える記録は、横方向のページめくり（◀▶、日付めくり帯#history-stripと
 * 近い見た目）で辿る。
 */

/** サムネイル1マスの一辺（CSSピクセル）。実セル・ダミーセルの両方で共通に使う。 */
const THUMBNAIL_SIZE_PX = 120;

/** グリッドの列数・行数を画面幅で切り替える閾値。style.cssの他のモバイル
 *  分岐（@media (max-width: 480px)）と揃える。 */
const MOBILE_BREAKPOINT_QUERY = "(max-width: 480px)";

/** 1ページあたりの列数・行数。デスクトップ3×3=9マス、モバイル2×2=4マス
 *  （ユーザー指示）——窓の大きさを常に一定にするため、実データの件数に
 *  関わらずこの数だけセル（実セル＋ダミーセル）を毎回描く。 */
function cellsPerPage(): { cols: number; rows: number } {
  const isMobile = window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
  return isMobile ? { cols: 2, rows: 2 } : { cols: 3, rows: 3 };
}

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
  private prevPageBtn: HTMLButtonElement;
  private nextPageBtn: HTMLButtonElement;
  private pageLabel: HTMLElement;
  private setVisible: (show: boolean) => void;
  private opened = false;
  private lastFocused: HTMLElement | null = null;
  private onSelectDate: ((dateKey: string) => void) | null = null;

  /** 開いた時点で読み込み、閉じるまで固定する日付一覧（新しい日が先）。
   *  ページ送りのたびに読み直す必要は無い——ドラッグでの持ち出し等、
   *  開いている間にアーカイブ自体が増減する操作をこの画面は持たないため。 */
  private dateKeys: string[] = [];
  private page = 0;

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

    this.grid = document.createElement("div");
    this.grid.className = "record-grid-cells";
    this.sheet.appendChild(this.grid);

    // ページめくり（ヘッダー右上の日付めくり帯#history-stripと近い見た目の
    // ◀ページ数▶）。1ページに収まる件数でも常に表示し続ける——枠数を
    // 超えたページ数の時だけ活性化する（ユーザー指示：窓の大きさ・形を
    // 記録の件数に関わらず常に一定にしたいため、要素自体の出し引きはしない）。
    const pagination = document.createElement("div");
    pagination.className = "record-grid-pagination";
    this.prevPageBtn = document.createElement("button");
    this.prevPageBtn.type = "button";
    this.prevPageBtn.className = "record-grid-page-btn";
    this.prevPageBtn.setAttribute("aria-label", "前のページへ");
    this.prevPageBtn.textContent = "◀";
    this.prevPageBtn.addEventListener("click", () => {
      this.page -= 1;
      this.renderPage();
    });
    this.pageLabel = document.createElement("span");
    this.pageLabel.className = "record-grid-page-label";
    this.nextPageBtn = document.createElement("button");
    this.nextPageBtn.type = "button";
    this.nextPageBtn.className = "record-grid-page-btn";
    this.nextPageBtn.setAttribute("aria-label", "次のページへ");
    this.nextPageBtn.textContent = "▶";
    this.nextPageBtn.addEventListener("click", () => {
      this.page += 1;
      this.renderPage();
    });
    pagination.append(this.prevPageBtn, this.pageLabel, this.nextPageBtn);
    this.sheet.appendChild(pagination);

    this.setVisible = createFadeVisibility(this.root);
    document.body.appendChild(this.root);
  }

  /** 開いた瞬間に一度だけ日付一覧を読み込み、1ページ目から描く。並び順は
   *  新しい日が先（ユーザー指示）——日付キーは"YYYY-MM-DD"形式のため文字列の
   *  降順でそのまま新しい順になる。 */
  private refresh(): void {
    this.dateKeys = listArchivedDateKeys().sort((a, b) => b.localeCompare(a));
    this.page = 0;
    this.renderPage();
  }

  /** 今のページ（this.page）の中身を描き直す。1ページの枠数
   *  （cellsPerPage()、画面幅で決まる）ぶん常に同じ数のセルを描き、実データが
   *  足りない分はダミーセルで埋める——窓の大きさ・形を件数に関わらず一定に
   *  保つ（ユーザー指示）。画面幅が変わるたびにも呼び直せるよう副作用を
   *  ここへ閉じ込めてある（window resizeリスナー参照）。 */
  private renderPage(): void {
    const { cols, rows } = cellsPerPage();
    const pageSize = cols * rows;
    this.grid.style.gridTemplateColumns = `repeat(${cols}, ${THUMBNAIL_SIZE_PX}px)`;

    const totalPages = Math.max(1, Math.ceil(this.dateKeys.length / pageSize));
    this.page = Math.max(0, Math.min(this.page, totalPages - 1));
    const start = this.page * pageSize;
    const pageItems = this.dateKeys.slice(start, start + pageSize);

    this.grid.innerHTML = "";
    for (let i = 0; i < pageSize; i++) {
      const dateKey = pageItems[i];
      this.grid.appendChild(dateKey ? this.buildCell(dateKey) : buildDummyCell());
    }

    this.pageLabel.textContent = `${this.page + 1} / ${totalPages}`;
    this.prevPageBtn.disabled = this.page === 0;
    this.nextPageBtn.disabled = this.page >= totalPages - 1;
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
    if (ev.key === "Escape") {
      this.close();
      return;
    }
    if (ev.key === "ArrowRight") {
      this.page += 1;
      this.renderPage();
    } else if (ev.key === "ArrowLeft") {
      this.page -= 1;
      this.renderPage();
    }
  };

  /** 画面幅が変わる（ウィンドウリサイズ・端末回転）とcellsPerPage()の結果
   *  自体が変わり得るため、開いている間だけ描き直す。 */
  private onResize = (): void => {
    this.renderPage();
  };

  open(onSelectDate: (dateKey: string) => void): void {
    if (this.opened) return;
    this.opened = true;
    this.onSelectDate = onSelectDate;
    this.refresh();
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.setVisible(true);
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("resize", this.onResize);
    requestAnimationFrame(() => this.sheet.focus());
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("resize", this.onResize);
    this.setVisible(false);
    this.lastFocused?.focus();
    this.lastFocused = null;
  }
}

function formatCellDateLabel(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${m}月${d}日`;
}

/** UI装飾用の薄いインク色（メモ本体のインク色とは無関係）。usageGuide.tsの
 *  guideInkColor()と同じ考え方で、テーマのCSS変数から読む。 */
function silhouetteInkColor(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--ink-35").trim() ||
    "oklch(22% 0.012 55 / 0.35)"
  );
}

/**
 * ダミーセル（そのページの枠数に実データが満たない分を埋める、中身の無い
 * セル）のサムネイル。円相のキャンバスと同じ角丸正方形（CANVAS_FRAME_SHAPE）
 * を、塗りつぶさず薄い輪郭線だけで描く（ユーザー指示：既存の空状態シルエットと
 * 同じ見た目）——実際のメモは一切描かない。
 */
function renderDummyThumbnail(canvas: HTMLCanvasElement): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const size = THUMBNAIL_SIZE_PX;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const lineWidth = 2;
  const half = size / 2 - lineWidth;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = silhouetteInkColor();
  ctx.stroke(CANVAS_FRAME_SHAPE.buildPath(half));
  ctx.restore();
}

/** 実セル（buildCell）と同じ見た目の骨格（サムネイル＋ラベル欄）にすることで、
 *  同じ行に実セルと混在してもグリッドの行の高さが揃う。クリック・フォーカス
 *  対象ではないため<button>ではなく<div>にし、aria-hidden・空のラベルで
 *  スクリーンリーダー・タブ移動からは見えないようにする。 */
function buildDummyCell(): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "record-grid-cell record-grid-cell--dummy";
  cell.setAttribute("aria-hidden", "true");

  const canvas = document.createElement("canvas");
  canvas.className = "record-grid-thumb record-grid-thumb--dummy";
  cell.appendChild(canvas);
  renderDummyThumbnail(canvas);

  const label = document.createElement("span");
  label.className = "record-grid-cell-label";
  label.textContent = " ";
  cell.appendChild(label);

  return cell;
}
