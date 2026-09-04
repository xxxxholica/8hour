import { dateKeyFor, shiftDateKey } from "./dailyReset";
import { CANVAS_FRAME_SHAPE } from "./frameShape";
import { createFadeVisibility } from "./fadeVisibility";
import { renderMemoThumbnail } from "./memoRenderer";
import { drawRuledPaper } from "./paper";
import { listArchivedDateKeys, loadArchive } from "./storage";

/**
 * 記録一覧画面：書き込みのあった日（archive:<日付>キーが存在する日）を、
 * 日曜始まりの週固定のグリッドで一覧表示する専用の全画面オーバーレイ。
 *
 * 円相は「一覧・検索UIを持たない」を原則としているが、この画面はその明示的な
 * 例外として扱う（ユーザー指示）。設定メニュー・日付めくり画面
 * （main.ts #history-strip/#history-view）とは完全に独立した全画面
 * オーバーレイにする——骨格・シングルトンで使い回す構成・フォーカスの作法は
 * usageGuide.tsに揃える。
 *
 * グリッドは索引役に徹し、実際の閲覧・ドラッグでの持ち出しは既存の日付めくり
 * 画面に一本化する（ユーザー指示）。セルをタップしても、その場でプレビューや
 * 操作をさせるのではなく、onSelectDateで日付だけを呼び出し側（main.ts）に
 * 渡してこの画面自身は閉じる——その日を実際に開く処理（setHistoryOffset）は
 * 呼び出し側が持つ。
 *
 * 窓（.record-grid-sheet）の大きさ・形は記録の件数に関わらず常に一定にする
 * （ユーザー指示）——3×3=9マスのグリッドを、デスクトップ・モバイル共通で
 * 常に「日・月・火・水・木・金・土＋前の週へ＋次の週へ」の9項目で固定に埋める。
 * 実データが無い曜日は、本体キャンバスと同じ罫線入りの紙の上に曜日バッジを
 * 重ねたダミーセルにする。ページ送りは週単位——1ページ目は常に今週で、
 * アーカイブされた最も古い日付が属する週より前へは進めない。
 */

/** サムネイル1マスの一辺（CSSピクセル）。実セル・ダミーセルの両方で共通に使う。
 *  3×3固定でデスクトップ・モバイル共通のレイアウトにしたため（ユーザー指示）、
 *  402px幅程度の画面でも3列が窮屈にならない大きさに抑えてある。 */
const THUMBNAIL_SIZE_PX = 96;

/** 日曜(0)始まりの曜日ラベル。 */
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

let overlay: RecordGrid | null = null;

/** onSelectDateは、セルをタップして画面を閉じた直後に一度だけ、選ばれた
 *  日付キー（"YYYY-MM-DD"）を渡して呼ばれる。 */
export function openRecordGrid(onSelectDate: (dateKey: string) => void): void {
  if (!overlay) overlay = new RecordGrid();
  overlay.open(onSelectDate);
}

/** dateKeyの曜日（0=日曜〜6=土曜、Date.prototype.getDayと同じ）。 */
function dayOfWeek(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** dateKeyが属する週の日曜日のdateKey。 */
function sundayOf(dateKey: string): string {
  return shiftDateKey(dateKey, -dayOfWeek(dateKey));
}

class RecordGrid {
  private root: HTMLElement;
  private sheet: HTMLElement;
  private grid: HTMLElement;
  private prevWeekBtn: HTMLButtonElement;
  private nextWeekBtn: HTMLButtonElement;
  private weekRangeLabel: HTMLElement;
  private setVisible: (show: boolean) => void;
  private opened = false;
  private lastFocused: HTMLElement | null = null;
  private onSelectDate: ((dateKey: string) => void) | null = null;

  /** 開いた時点で読み込み、閉じるまで固定するarchive日付の集合（曜日ごとの
   *  実データ有無の判定に使う）と、最古の日付が属する週の日曜日（「前の週へ」
   *  の境界）。週送りのたびに読み直す必要は無い——ドラッグでの持ち出し等、
   *  開いている間にアーカイブ自体が増減する操作をこの画面は持たないため。 */
  private archivedDateSet = new Set<string>();
  private oldestWeekSunday: string | null = null;
  /** 0=今週（1ページ目）、1=先週、2=先々週…。 */
  private weekIndex = 0;

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

    // 週送りボタンは、日〜土の7マスと同じグリッドの8・9番目のマスとして
    // 埋め込む（ユーザー指示）。紙質の実セル・ダミーセルとは見た目で区別する
    // （style.css .record-grid-nav-cell、黒背景＋白い矢印）ため、canvas描画は
    // 使わずボタン要素そのものをセルにする。
    this.prevWeekBtn = this.buildNavCell("prev", "前の週へ", "◀");
    this.nextWeekBtn = this.buildNavCell("next", "次の週へ", "▶");

    // 以前は「1/2ページ」のようなページ番号をここ（グリッドの下）に表示して
    // いたが、週固定になったのに合わせ、表示中の週の日付範囲
    // （例:「10月10日〜10月17日」）に置き換える（ユーザー指示）。
    this.weekRangeLabel = document.createElement("p");
    this.weekRangeLabel.className = "record-grid-week-range";
    this.sheet.appendChild(this.weekRangeLabel);

    this.setVisible = createFadeVisibility(this.root);
    document.body.appendChild(this.root);
  }

  private buildNavCell(direction: "prev" | "next", label: string, glyph: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "record-grid-cell record-grid-nav-cell";
    btn.setAttribute("aria-label", label);
    btn.textContent = glyph;
    btn.addEventListener("click", () => {
      this.weekIndex += direction === "prev" ? 1 : -1;
      this.renderWeek();
    });
    return btn;
  }

  /** 開いた瞬間に一度だけarchive日付を読み込み、今週（1ページ目）から描く。 */
  private refresh(): void {
    const dateKeys = listArchivedDateKeys();
    this.archivedDateSet = new Set(dateKeys);
    const oldestDateKey = dateKeys.length > 0 ? dateKeys.slice().sort()[0] : null;
    this.oldestWeekSunday = oldestDateKey ? sundayOf(oldestDateKey) : null;
    this.weekIndex = 0;
    this.renderWeek();
  }

  /** 今表示している週（this.weekIndex）の中身を描き直す。日〜土の7マス＋
   *  前週／次週ボタンの計9マスを、件数に関わらず常に同じ構成で描く
   *  （ユーザー指示：窓の大きさ・形を常に一定にするため）。実データが無い
   *  曜日はダミーセル（罫線入りの紙＋曜日バッジ）にする。 */
  private renderWeek(): void {
    const todayKey = dateKeyFor(new Date());
    const currentWeekSunday = sundayOf(todayKey);
    const displayedSunday = shiftDateKey(currentWeekSunday, -7 * this.weekIndex);

    this.grid.innerHTML = "";
    for (let weekday = 0; weekday < 7; weekday++) {
      const dateKey = shiftDateKey(displayedSunday, weekday);
      const cell = this.archivedDateSet.has(dateKey)
        ? this.buildCell(dateKey)
        : buildWeekdayDummyCell(weekday);
      this.grid.appendChild(cell);
    }
    this.grid.appendChild(this.prevWeekBtn);
    this.grid.appendChild(this.nextWeekBtn);

    const saturdayKey = shiftDateKey(displayedSunday, 6);
    this.weekRangeLabel.textContent = `${formatCellDateLabel(displayedSunday)}〜${formatCellDateLabel(saturdayKey)}`;

    // 「前の週へ」は、最も古いarchive日付が属する週にいる（またはそもそも
    // 記録が1件も無い）間は非活性にする（ユーザー指示）。「次の週へ」は
    // 今週（weekIndex===0）の間は非活性——日付めくり帯の「進む」が今日で
    // 非活性になるのと同じ考え方。
    this.prevWeekBtn.disabled = this.oldestWeekSunday === null || displayedSunday === this.oldestWeekSunday;
    this.nextWeekBtn.disabled = this.weekIndex === 0;
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
    if (ev.key === "ArrowRight" && !this.nextWeekBtn.disabled) {
      this.weekIndex -= 1;
      this.renderWeek();
    } else if (ev.key === "ArrowLeft" && !this.prevWeekBtn.disabled) {
      this.weekIndex += 1;
      this.renderWeek();
    }
  };

  open(onSelectDate: (dateKey: string) => void): void {
    if (this.opened) return;
    this.opened = true;
    this.onSelectDate = onSelectDate;
    this.refresh();
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

/** UI装飾用の色をテーマのCSS変数から読む共通ヘルパー。usageGuide.tsの
 *  guideInkColor()と同じ考え方——フォールバックはCSS変数未定義時の保険。 */
function themeColor(varName: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
}

/**
 * ダミーセル（実データの無い曜日を埋める、中身の無いセル）のサムネイル。
 * 本体キャンバスと同じ罫線入りの紙（drawRuledPaper、CANVAS_FRAME_SHAPEで
 * クリップ）の上に、曜日バッジ（丸＋文字）を重ねて描く（ユーザー指示）。
 * 実際のメモは一切描かない。
 */
function renderDummyThumbnail(canvas: HTMLCanvasElement, weekday: number): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const size = THUMBNAIL_SIZE_PX;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const half = size / 2;
  ctx.save();
  ctx.translate(half, half);
  ctx.clip(CANVAS_FRAME_SHAPE.buildPath(half));
  drawRuledPaper(ctx, half);
  ctx.restore();

  drawWeekdayBadge(ctx, half, half, half * 0.34, weekday);
}

/** 曜日バッジ：土曜＝青地に白文字「土」、日曜＝赤地に白文字「日」、それ以外＝
 *  白地（輪郭線あり）に濃色文字でその曜日の漢字1文字（ユーザー指示）。 */
function drawWeekdayBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  weekday: number
): void {
  const isSunday = weekday === 0;
  const isSaturday = weekday === 6;

  let fill: string;
  let strokeColor: string | null = null;
  let textColor: string;
  if (isSunday) {
    fill = themeColor("--accent-red", "oklch(52% 0.2 25)");
    textColor = "#ffffff";
  } else if (isSaturday) {
    fill = themeColor("--accent-blue", "oklch(48% 0.16 258)");
    textColor = "#ffffff";
  } else {
    fill = "#ffffff";
    strokeColor = themeColor("--ink-20", "oklch(22% 0.012 55 / 0.2)");
    textColor = themeColor("--ink-70", "oklch(22% 0.012 55 / 0.7)");
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (strokeColor) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
  }
  ctx.fillStyle = textColor;
  ctx.font = `600 ${Math.round(radius)}px "Noto Sans JP", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(WEEKDAY_LABELS[weekday], cx, cy + radius * 0.05);
  ctx.restore();
}

/** 実セル（buildCell）と同じ見た目の骨格（サムネイル＋ラベル欄）にすることで、
 *  同じ行に実セルと混在してもグリッドの行の高さが揃う。クリック・フォーカス
 *  対象ではないため<button>ではなく<div>にし、aria-hidden・空のラベルで
 *  スクリーンリーダー・タブ移動からは見えないようにする。 */
function buildWeekdayDummyCell(weekday: number): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "record-grid-cell record-grid-cell--dummy";
  cell.setAttribute("aria-hidden", "true");

  const canvas = document.createElement("canvas");
  canvas.className = "record-grid-thumb record-grid-thumb--dummy";
  cell.appendChild(canvas);
  renderDummyThumbnail(canvas, weekday);

  const label = document.createElement("span");
  label.className = "record-grid-cell-label";
  label.textContent = " ";
  cell.appendChild(label);

  return cell;
}
