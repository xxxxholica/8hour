import { computeSquareSize } from "./canvasSizing";
import { dateKeyFor, shiftDateKey } from "./dailyReset";
import { CANVAS_FRAME_SHAPE } from "./frameShape";
import { renderMemoThumbnail } from "./memoRenderer";
import { drawRuledPaper } from "./paper";
import { listArchivedDateKeys, loadArchive } from "./storage";

/**
 * 記録一覧画面：書き込みのあった日（archive:<日付>キーが存在する日）を、
 * 日曜始まりの週固定のグリッドで一覧表示する専用の画面。
 *
 * 円相は「一覧・検索UIを持たない」を原則としているが、この画面はその明示的な
 * 例外として扱う（ユーザー指示）。日付めくり画面（main.ts #history-view、
 * ArchiveCanvas）と同じ「`#canvas-panel`内で本体キャンバスの場所と入れ替える」
 * 方式で表示する——独立した浮遊モーダルだった以前の実装から変更した
 * （ユーザー指示：過去の記録グリッドの表示方式変更）。表示・非表示の制御
 * （hidden属性の付け替え、3画面の排他）自体はmain.ts側（setActiveView）が
 * 持ち、このクラスは渡されたコンテナへマウントされたビューの中身の構築・
 * activate/deactivateだけを受け持つ——ArchiveCanvasと同じ役割分担。
 *
 * グリッドは索引役に徹し、実際の閲覧・ドラッグでの持ち出しは既存の日付めくり
 * 画面に一本化する（ユーザー指示）。セルをタップしても、その場でプレビューや
 * 操作をさせるのではなく、onCloseで選ばれた日付だけを呼び出し側（main.ts）に
 * 渡す——その日を実際に開く処理（setHistoryOffset）は呼び出し側が持つ。
 *
 * 見た目はiOS/Androidのアプリ切り替え画面（タブオーバービュー）を参考にする
 * （ユーザー指示）：共有のカード枠（背景・境界線・タイトルバー・×ボタン）を
 * 一切持たず、9マスそれぞれの紙（サムネイル）が単独で影（--canvas-shadow、
 * .record-grid-thumb）を落として浮いているだけの見た目にする。閉じる手段も
 * 専用の×ボタンではなく、「開くのに使ったトリガーボタンをもう一度押す」か
 * 「マス以外の場所をタップする」のどちらか（main.ts参照）——これもタブ
 * 切り替え画面と同じ操作感。
 *
 * グリッド自体（.record-grid-cells）の大きさ・形は記録の件数に関わらず常に
 * 一定にする（ユーザー指示）——3×3=9マスを、デスクトップ・モバイル共通で
 * 常に「日・月・火・水・木・金・土＋前の週へ＋次の週へ」の9項目で固定に埋める。
 * 実データが無い曜日は、本体キャンバスと同じ罫線入りの紙の上に曜日バッジを
 * 重ねたダミーセルにする。ページ送りは週単位——1ページ目は常に今週で、
 * アーカイブされた最も古い日付が属する週より前へは進めない。
 *
 * グリッド全体（9マス＋隙間）は、本体キャンバスと同じか、それ以下の大きさに
 * なるよう常に拡大・縮小する（ユーザー指示：本体キャンバスの縮小版のように
 * 見せたい）。以前はデスクトップだけ本体キャンバスに近い固定の大きさ
 * （190px/マス）にtransform: scaleで合わせ、モバイルは80px/マス固定のまま
 * 変えていなかったが、モバイルではその結果グリッド全体が本体キャンバスより
 * 明らかに小さく見えてしまっていた（ユーザー報告：スマホ版が特に小さい）。
 * デスクトップ／モバイルで場合分けするのをやめ、syncGridSizeが常に
 * 「本体キャンバスの実際の見た目のサイズ」から逆算した1マスの大きさを
 * 直接JSで指定する方式に統一した——transform: scaleによる見た目の縮小
 * （旧syncDesktopScale）ではなく、canvas自体をその大きさで描き直すため、
 * モバイルで拡大しても（旧実装のtransform: scaleでの拡大と違い）ぼやけない。
 */

/** 本体キャンバス（CircularCanvas、canvasView.ts）の実際の見た目の一辺
 *  （紙の正方形部分、px）を、渡されたコンテナのサイズから
 *  canvasSizing.ts fitCanvasToContainerの既定のcontentScaleFactor
 *  （main.tsのCircularCanvasはこれを上書きしていない）と同じ計算式で逆算
 *  する——記録一覧のグリッド全体を本体キャンバスと同じか、それ以下の大きさに
 *  する（ユーザー指示）ための比較対象。
 *
 *  以前は`#canvas-wrap`を直接読んでいたが、記録一覧を`#canvas-panel`内へ
 *  埋め込む方式に変えたことで、記録一覧を表示している間は`#canvas-wrap`が
 *  hidden（表示サイズ0）になり参照元として使えなくなった。`#record-grid-view`
 *  （このクラスに渡されるコンテナ）は`#canvas-wrap`と全く同じflexレイアウト
 *  で`#canvas-panel`の同じ内容領域を占めるため、自分自身のコンテナを読めば
 *  `#canvas-wrap`が表示されていた場合と同じ値になる——「本体キャンバスの
 *  実物を読んで合わせる」のではなく「同じ入れ物を共有しているから自然に
 *  揃う」という、ArchiveCanvasと同じ考え方に揃えた。 */
const MAIN_CANVAS_CONTENT_SCALE_FACTOR = 0.43;
function mainCanvasPaperSizePx(container: HTMLElement): number {
  return computeSquareSize(container) * MAIN_CANVAS_CONTENT_SCALE_FACTOR * 2;
}

/** グリッド全体を本体キャンバスよりわずかに小さめに収める安全マージン
 *  （旧syncDesktopScaleの94%をそのまま踏襲）。 */
const GRID_SAFETY_MARGIN = 0.94;
/** マス間の隙間（px）。以前はCSS側の`var(--space-3)`（デスクトップは
 *  `1rem`）に任せていたが、1マスの大きさ自体をJSで計算する以上、隙間も
 *  同じ場所（syncGridSize）でJSから指定し、計算の前提を1箇所にまとめる。 */
const GRID_GAP_PX = 12;
/** セル（.record-grid-cell）のサムネイル周りのpadding（px）。style.css
 *  `.record-grid-cell`の`padding: var(--space-2)`と同じ値——ここを変える
 *  場合はCSS側も揃えること。 */
const CELL_PADDING_PX = 8;
/** サムネイル1マスの一辺の下限（px）。極端に狭い画面幅でも読み取れる大きさを
 *  保証する（タップ対象としての最低限の大きさも兼ねる）。 */
const MIN_THUMBNAIL_SIZE_PX = 64;
/** mainCanvasPaperSizePxがまだ計測できない（コンテナのサイズが0）場合の
 *  フォールバック——実運用ではactivate()の時点でコンテナは既に表示済みの
 *  ため、通常は使われない保険。 */
const FALLBACK_THUMBNAIL_SIZE_PX = 96;

/** 日曜(0)始まりの曜日ラベル。 */
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/** dateKeyの曜日（0=日曜〜6=土曜、Date.prototype.getDayと同じ）。toolbar.ts
 *  （記録一覧トリガー、前日が空の時の円形バッジ）でも使うためexportしている。 */
export function dayOfWeek(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** dateKeyが属する週の日曜日のdateKey。 */
function sundayOf(dateKey: string): string {
  return shiftDateKey(dateKey, -dayOfWeek(dateKey));
}

/** activate/deactivateで渡す通知。セルタップなら選ばれた日付キー、マス以外の
 *  場所のタップ・Escapeでの単純な取り消しならnullを渡す——main.ts側
 *  （handleRecordGridClose）がこの2通りを区別して、日付めくり画面への遷移／
 *  開く前の画面への復元を出し分ける。 */
export type RecordGridCloseHandler = (dateKey: string | null) => void;

export class RecordGrid {
  private container: HTMLElement;
  private grid: HTMLElement;
  private prevWeekBtn: HTMLButtonElement;
  private nextWeekBtn: HTMLButtonElement;
  private active = false;
  private lastFocused: HTMLElement | null = null;
  private onClose: RecordGridCloseHandler | null = null;
  /** サムネイル1マスの現在の一辺（px）。syncGridSizeが本体キャンバスの実際の
   *  大きさから逆算して更新する——固定のブレークポイント値ではなくなった
   *  ため、buildCell等はこのフィールド経由で参照する。 */
  private thumbnailSizePx = FALLBACK_THUMBNAIL_SIZE_PX;

  /** 開いた時点で読み込み、閉じるまで固定するarchive日付の集合（曜日ごとの
   *  実データ有無の判定に使う）と、最古の日付が属する週の日曜日（「前の週へ」
   *  の境界）。週送りのたびに読み直す必要は無い——ドラッグでの持ち出し等、
   *  開いている間にアーカイブ自体が増減する操作をこの画面は持たないため。 */
  private archivedDateSet = new Set<string>();
  private oldestWeekSunday: string | null = null;
  /** 0=今週（1ページ目）、1=先週、2=先々週…。 */
  private weekIndex = 0;

  /** containerはmain.tsの`#record-grid-view`——`#canvas-wrap`/`#history-view`
   *  と同じ`#canvas-panel`直下の入れ物で、表示・非表示（hidden属性）自体は
   *  main.ts側（setActiveView）が持つ。ArchiveCanvasと同じ役割分担で、この
   *  クラスは「渡されたコンテナの中身を組み立てる・activate中だけリサイズ
   *  監視やキー操作を有効にする」だけを担当する。 */
  constructor(container: HTMLElement) {
    this.container = container;

    this.grid = document.createElement("div");
    this.grid.className = "record-grid-cells";
    this.grid.tabIndex = -1;
    this.container.appendChild(this.grid);

    // 週送りボタンは、日〜土の7マスと同じグリッドの8・9番目のマスとして
    // 埋め込む（ユーザー指示）。紙質の実セル・ダミーセルとは見た目で区別する
    // （style.css .record-grid-nav-cell、黒背景＋白い矢印）ため、canvas描画は
    // 使わずボタン要素そのものをセルにする。
    this.prevWeekBtn = this.buildNavCell("prev", "前の週へ", "◀");
    this.nextWeekBtn = this.buildNavCell("next", "次の週へ", "▶");

    // 「マス以外の場所をタップしたら閉じる」（ユーザー指示：×ボタンは不要、
    // タブ切り替え画面のように背景タップで戻る）。containerはこのグリッドを
    // 囲む唯一の場所（#record-grid-view全体）で、9マスの外側の余白は全てここに
    // 属する——closest(".record-grid-cell")が見つからなければ「マス以外」と
    // 判定する。単純な「イベントターゲット===container」比較だと、グリッドの
    // マス間の隙間（gap、.record-grid-cellsの内側だがどのセルの上でもない
    // 領域）を拾えないため、closestベースの判定にしている。activate中かどうかに
    // 関わらず常時アタッチしているが、非activate中はonClose自体がnullなので
    // requestCloseは何もしない。
    this.container.addEventListener("pointerdown", (ev) => {
      if (ev.target instanceof Element && ev.target.closest(".record-grid-cell")) return;
      this.requestClose(null);
    });
  }

  /** マス以外のタップ・Escape・セルタップのいずれも、このヘルパーを経由して
   *  onCloseへ一度だけ通知する。activate中かどうかに関わらず呼べるが、
   *  非activate中はonClose自体がnullのため何もしない。 */
  private requestClose(dateKey: string | null): void {
    this.onClose?.(dateKey);
  }

  /** 週送りボタンの見た目上の黒い正方形（.record-grid-nav-cell-box）。ボタン
   *  要素自体（.record-grid-cell、グリッドのstretchでマス目いっぱいに広がる）
   *  ではなく、内側のこのspanだけにthis.thumbnailSizePxと同じ一辺を明示的に
   *  指定する——ボタンの背景をそのままボタン全体（グリッドセルのpadding込みの
   *  外形）に塗ると、サムネイル（紙の見える範囲、外形よりpadding分小さい）
   *  より一回り大きく見えてしまい、「同じ紙が並んでいる」はずの9マスの中で
   *  週送りの2マスだけ見た目のサイズが揃わない（ユーザー指摘：実測でズレを
   *  確認）。syncGridSizeが1マスの大きさを再計算するたびに一辺を更新する。 */
  private navCellBoxes: HTMLElement[] = [];

  private buildNavCell(direction: "prev" | "next", label: string, glyph: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "record-grid-cell record-grid-nav-cell";
    btn.setAttribute("aria-label", label);
    const box = document.createElement("span");
    box.className = "record-grid-nav-cell-box";
    box.textContent = glyph;
    btn.appendChild(box);
    this.navCellBoxes.push(box);
    btn.addEventListener("click", () => {
      // ネイティブのdisabledは使わず見た目だけの非活性化（setNavCellDisabled
      // 参照）のため、ここで自分で無視する必要がある。
      if (btn.getAttribute("aria-disabled") === "true") return;
      this.weekIndex += direction === "prev" ? 1 : -1;
      this.renderWeek();
    });
    return btn;
  }

  /** サムネイル（実セル・ダミーセル）と週送りボタンの黒い正方形を、常に
   *  同じ一辺（this.thumbnailSizePx）に揃える。 */
  private syncNavCellSize(): void {
    const size = `${this.thumbnailSizePx}px`;
    for (const box of this.navCellBoxes) {
      box.style.width = size;
      box.style.height = size;
    }
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
        : buildWeekdayDummyCell(weekday, this.thumbnailSizePx);
      this.grid.appendChild(cell);
    }
    this.grid.appendChild(this.prevWeekBtn);
    this.grid.appendChild(this.nextWeekBtn);

    // 「前の週へ」は、最も古いarchive日付が属する週にいる（またはそもそも
    // 記録が1件も無い）間は非活性にする（ユーザー指示）。「次の週へ」は
    // 今週（weekIndex===0）の間は非活性——日付めくり帯の「進む」が今日で
    // 非活性になるのと同じ考え方。
    this.setNavCellDisabled(this.prevWeekBtn, this.oldestWeekSunday === null || displayedSunday === this.oldestWeekSunday);
    this.setNavCellDisabled(this.nextWeekBtn, this.weekIndex === 0);
  }

  /** 週送りボタンの非活性化は、ネイティブのdisabled属性ではなく見た目
   *  （グレーアウト、CSSの[aria-disabled="true"]）だけで表現する。ネイティブの
   *  disabled（+ pointer-events: none）にすると、グレーアウト中のボタンへの
   *  タップがヒットテストをすり抜けて背景（#record-grid-view）まで届いてしまい、
   *  「マス以外をタップしたら閉じる」（requestClose、closest(".record-grid-cell")
   *  判定）が誤って発火し、押しただけで記録一覧ごと閉じて元のキャンバスへ
   *  戻ってしまう不具合があった（ユーザー報告）。押しても何も起きなくてよいが、
   *  タップ自体はこのボタンで受け止めて他へ抜けさせない必要があるため、当たり
   *  判定は常に有効なままにし、クリックハンドラ側（buildNavCell）でaria-disabled
   *  を見て何もしない、という形にしている。 */
  private setNavCellDisabled(btn: HTMLButtonElement, disabled: boolean): void {
    btn.setAttribute("aria-disabled", String(disabled));
    btn.tabIndex = disabled ? -1 : 0;
  }

  /** グリッドは索引役に徹する（ユーザー指示）——セル自体はドラッグ・
   *  プレビュー等の操作を一切持たず、タップすると日付めくり画面のその日へ
   *  遷移する（requestClose経由でmain.tsのhandleRecordGridCloseへ）だけの
   *  単純なボタン。 */
  private buildCell(dateKey: string): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "record-grid-cell";
    btn.setAttribute("aria-label", formatCellDateLabel(dateKey));
    btn.addEventListener("click", () => this.requestClose(dateKey));

    // 日付ラベルは別要素（下に積む<span>等）にせず、サムネイルと同じcanvasに
    // 直接描く——セルの見た目の大きさをサムネイル＝正方形とぴったり一致させる
    // ため（ユーザー指示：9マス全てを完全に同じ正方形サイズにしたい。別要素
    // にすると、その分の高さが上乗せされて縦長になってしまっていた）。
    // withRuledPaper=trueで、ダミーセル（罫線入りの紙＋曜日バッジ）と同じ
    // 罫線入りの紙を背景にする——実データがあってもインクの線が細くて目立たず
    // 「空白に見える」という指摘への対応も兼ねる。
    const canvas = document.createElement("canvas");
    canvas.className = "record-grid-thumb";
    btn.appendChild(canvas);
    const size = this.thumbnailSizePx;
    renderMemoThumbnail(canvas, loadArchive(dateKey), size, true);
    drawDateCaption(canvas, size, formatCellDateLabel(dateKey));

    return btn;
  }

  /** デスクトップだけ、グリッド（.record-grid-cells）の見た目の大きさを本体
   *  キャンバスと同じか、それ以下になるよう、サムネイル1マスの大きさ
   *  （this.thumbnailSizePx）自体を本体キャンバスの実際の見た目のサイズ
   *  （画面・ウィンドウの大きさに応じて変わる）から逆算する（デスクトップ・
   *  モバイル共通、ユーザー指示：スマホ版が特に小さいので大きくしたい）。
   *  3マス＋隙間2つでグリッド全体がtargetに収まるよう1マスの大きさを決め、
   *  .record-grid-cellsのgrid-template-columns/gapへ直接反映する——以前の
   *  transform: scaleによる見た目だけの拡大縮小と違い、canvas自体をこの
   *  大きさで描き直すため、モバイルで拡大しても画質が荒れない。 */
  private syncGridSize(): void {
    const target = mainCanvasPaperSizePx(this.container) * GRID_SAFETY_MARGIN;
    const rawCellOuter = target > 0 ? (target - GRID_GAP_PX * 2) / 3 : FALLBACK_THUMBNAIL_SIZE_PX + CELL_PADDING_PX * 2;
    const cellOuter = Math.max(MIN_THUMBNAIL_SIZE_PX + CELL_PADDING_PX * 2, rawCellOuter);
    this.thumbnailSizePx = cellOuter - CELL_PADDING_PX * 2;
    this.grid.style.gap = `${GRID_GAP_PX}px`;
    this.grid.style.gridTemplateColumns = `repeat(3, ${cellOuter}px)`;
    this.syncNavCellSize();
  }

  /** ウィンドウサイズが変わると、本体キャンバスの実際の大きさ（延いては
   *  サムネイルの大きさ）が変わるため、開いている間だけ描き直す。 */
  private onResize = (): void => {
    this.syncGridSize();
    this.renderWeek();
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    ev.stopPropagation();
    if (ev.key === "Escape") {
      this.requestClose(null);
      return;
    }
    if (ev.key === "ArrowRight" && this.nextWeekBtn.getAttribute("aria-disabled") !== "true") {
      this.weekIndex -= 1;
      this.renderWeek();
    } else if (ev.key === "ArrowLeft" && this.prevWeekBtn.getAttribute("aria-disabled") !== "true") {
      this.weekIndex += 1;
      this.renderWeek();
    }
  };

  /** main.tsのsetActiveViewが記録一覧へ切り替える瞬間に呼ぶ（コンテナの
   *  hidden属性を外すのはsetActiveView自身の役目——このクラスはコンテナの
   *  表示状態を一切変更しない）。onCloseはマス以外のタップ・Escape・
   *  セルタップのいずれかが起きた時に一度だけ呼ばれる（requestClose参照）。 */
  activate(onClose: RecordGridCloseHandler): void {
    if (this.active) return;
    this.active = true;
    this.onClose = onClose;
    this.syncGridSize();
    this.refresh();
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("resize", this.onResize);
    requestAnimationFrame(() => this.grid.focus());
  }

  /** main.tsのsetActiveViewが記録一覧から他画面へ切り替える瞬間に呼ぶ
   *  （コンテナを隠すのもsetActiveView自身の役目）。リサイズ監視・キー捕捉を
   *  解除し、開く前にフォーカスしていた要素へ戻す。 */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.onClose = null;
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("resize", this.onResize);
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
 * 実セルの日付ラベルを、サムネイルの下端にcanvas上へ直接描く。別要素
 * （<span>を下に積む形）にすると、その分の高さがセルに上乗せされて
 * サムネイルの正方形からズレてしまう（ユーザー指示：9マス全てを完全に
 * 同じ正方形サイズにしたい）——renderMemoThumbnail呼び出し後、同じcanvas
 * （dpr分のsetTransformは維持されたまま）に追い描きする。
 */
function drawDateCaption(canvas: HTMLCanvasElement, sizePx: number, text: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const half = sizePx / 2;
  ctx.save();
  ctx.translate(half, half);
  ctx.clip(CANVAS_FRAME_SHAPE.buildPath(half));
  const fontPx = Math.max(9, Math.round(half * 0.13));
  ctx.font = `500 ${fontPx}px "Noto Sans JP", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = themeColor("--ink-55", "oklch(22% 0.012 55 / 0.55)");
  ctx.fillText(text, 0, half - fontPx * 0.7);
  ctx.restore();
}

/**
 * ダミーセル（実データの無い曜日を埋める、中身の無いセル）のサムネイル。
 * 本体キャンバスと同じ罫線入りの紙（drawRuledPaper、CANVAS_FRAME_SHAPEで
 * クリップ）の上に、曜日バッジ（丸＋文字）を重ねて描く（ユーザー指示）。
 * 実際のメモは一切描かない。
 */
function renderDummyThumbnail(canvas: HTMLCanvasElement, weekday: number, size: number): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
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
 *  白地（輪郭線あり）に濃色文字でその曜日の漢字1文字（ユーザー指示）。
 *  toolbar.ts（記録一覧トリガー、前日が空の時の円形バッジ）でも同じ見た目を
 *  使うためexportしている。 */
export function drawWeekdayBadge(
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

/** 実セル（buildCell）と同じ見た目の骨格（canvas1つだけ）にすることで、
 *  同じ行に実セルと混在してもグリッドの行の高さ・幅が完全に一致し、9マス
 *  すべてが同じ正方形になる（ユーザー指示）。クリック・フォーカス対象では
 *  ないため<button>ではなく<div>にし、aria-hiddenでスクリーンリーダー・
 *  タブ移動からは見えないようにする。 */
function buildWeekdayDummyCell(weekday: number, size: number): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "record-grid-cell record-grid-cell--dummy";
  cell.setAttribute("aria-hidden", "true");

  const canvas = document.createElement("canvas");
  canvas.className = "record-grid-thumb record-grid-thumb--dummy";
  cell.appendChild(canvas);
  renderDummyThumbnail(canvas, weekday, size);

  return cell;
}
