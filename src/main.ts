import "./style.css";
import { ArchiveCanvas } from "./archiveCanvas";
import { CircularCanvas } from "./canvasView";
import { createFadeVisibility, FADE_TRANSITION_MS } from "./fadeVisibility";
import { daysBetween, dateKeyFor, performDailyResetIfNeeded, shiftDateKey } from "./dailyReset";
import { MemoStore } from "./memoStore";
import { RecordGrid } from "./recordGrid";
import { Toolbar } from "./toolbar";
import { SettingsMenu } from "./settingsMenu";
import {
  loadArchive,
  loadCustomThemeHue,
  loadFirstResetHintShown,
  loadThemePreference,
  loadUsageGuideSeen,
  markFirstResetHintShown,
  saveCustomThemeHue,
  saveThemePreference,
} from "./storage";
import { applyTheme } from "./theme";
import { openUsageGuide } from "./usageGuide";

// テーマ（自動/ライト/ダーク/好きな色）は、他の何よりも先に適用する——
// 後回しにすると一瞬ライトテーマで描画されてからダークへ切り替わる「ちらつき」
// が見えるため（ユーザー指示：設定ボタンを追加してテーマ変更機能を入れたい）。
applyTheme(loadThemePreference(), loadCustomThemeHue());

/** 「指定しなかったメモはサイレント保存されています」という一言ヒント
 *  （E2-14）。初回の朝リセットが実際に発生した瞬間にだけ、起動時・
 *  フォアグラウンド復帰時どちらのトリガーからも呼ばれる（呼び出し箇所は
 *  下記）。表示した瞬間にmarkFirstResetHintShown()を呼ぶため、以後は
 *  二度と出ない。関数宣言なので、このモジュール内どこからでも（定義より
 *  前の行からも）呼べる。 */
const FIRST_RESET_HINT_VISIBLE_MS = 6000;
function maybeShowFirstResetHint(): void {
  if (loadFirstResetHintShown()) return;
  markFirstResetHintShown();
  const el = document.createElement("p");
  el.className = "first-reset-hint fade-visible";
  el.hidden = true;
  el.textContent = "指定しなかったメモはサイレント保存されています";
  document.body.appendChild(el);
  const setVisible = createFadeVisibility(el);
  setVisible(true);
  window.setTimeout(() => {
    setVisible(false);
    window.setTimeout(() => el.remove(), FADE_TRANSITION_MS);
  }, FIRST_RESET_HINT_VISIBLE_MS);
}

// 朝リセット：起動時点で前回使用日から日付が変わっていれば、当日のキャンバスを
// アーカイブへ退避してから白紙にする（dailyReset.ts）。MemoStoreがlocalStorageの
// memosキーを読み込む前に必ず済ませておく必要がある。

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <div class="app-header-left">
      <div id="settings-slot"></div>
    </div>
    <div class="app-header-right">
      <div id="history-strip" class="history-strip">
        <span id="history-date-label" class="history-strip-label"></span>
      </div>
    </div>
  </header>
  <main class="app-main">
    <div id="canvas-panel" class="view-panel">
      <div id="canvas-wrap" class="fade-visible is-visible"></div>
      <div id="canvas-info-row" class="info-row"></div>
      <div id="history-view" class="history-view fade-visible" hidden>
        <div id="archive-canvas-wrap" class="archive-canvas-wrap"></div>
      </div>
      <div id="record-grid-view" class="record-grid-view fade-visible" hidden></div>
      <div id="history-drop-zone" class="history-drop-zone" hidden>
        <span class="history-drop-zone-label">離すと本日へ</span>
      </div>
    </div>
  </main>
  <footer class="app-footer">
    <div id="panel-swatch-slot" class="panel-swatches"></div>
    <div class="footer-tools-row">
      <div class="control-panel">
        <div class="control-panel-body">
          <div id="primary-slot"></div>
        </div>
      </div>
      <div id="record-grid-trigger-slot" class="record-grid-trigger-card"></div>
    </div>
  </footer>
`;

if (performDailyResetIfNeeded()) maybeShowFirstResetHint();
const store = new MemoStore();

// .app-footerの高さ（--app-footer-height）は、モバイル幅ではハンドルの開閉で
// 変わるようになった（style.css .control-panel-body参照）。実際の高さを
// ResizeObserverで追従させる（決め打ちの値だとハンドル開閉のたびにズレてしまう）。
const appFooterEl = document.querySelector<HTMLElement>(".app-footer")!;
const syncAppFooterHeightVar = () => {
  document.documentElement.style.setProperty("--app-footer-height", `${appFooterEl.getBoundingClientRect().height}px`);
};
new ResizeObserver(syncAppFooterHeightVar).observe(appFooterEl);
syncAppFooterHeightVar();

const canvasWrap = document.querySelector<HTMLDivElement>("#canvas-wrap")!;
const primarySlot = document.querySelector<HTMLDivElement>("#primary-slot")!;
const colorSwatchSlot = document.querySelector<HTMLDivElement>("#panel-swatch-slot")!;
const recordGridTriggerSlot = document.querySelector<HTMLDivElement>("#record-grid-trigger-slot")!;

// 以前はトリガーの中身がボタン1個だけの時があり、幅<高さになってしまう
// （縦横比が1:1にならない）ため、実測した高さをそのまま幅へ書き込んで
// 正方形に強制するJS（旧syncRecordGridTriggerSquare）が必要だった。今は
// 中身が常に◀[バッジ]▶の3点セットになり、そもそも正方形にする対象では
// なくなった（ユーザー指示：前日へ戻るボタンを今日を見ている間も常時
// 出しておきたい）ため、この仕組みごと撤去した——widthは
// .record-grid-trigger-card（style.css）のfit-contentに任せる。

const onToolChange = () => {
  canvasView.closeWritingSession();
  canvasView.finishTextEditingIfOpen();
};
// 記録一覧画面（recordGrid.ts）：道具バー（.control-panel）とは別の独立した
// カード（#record-grid-trigger-slot、.footer-tools-row内の兄弟要素）に置いた
// トグルボタンから開閉する（ユーザー指示：道具選択ピルとは視覚的にも完全に
// 別で見えるようにしたい）。セルをタップして選ばれた日付は、日付めくり画面
// （setHistoryOffset、下記で定義）へそのまま渡して開く——グリッド側は索引役に
// 徹し、閲覧・持ち出しの操作は日付めくり画面に一本化する（ユーザー指示）。
// toggleRecordGridView/setHistoryOffsetはどちらも関数宣言（巻き上げられる）
// のため、実際に呼ばれる時点（ユーザーがトリガーやセルを操作した後）には
// 定義済みであれば良く、ここで先に参照しても問題ない。
const toolbar = new Toolbar(primarySlot, colorSwatchSlot, onToolChange, () => canvasView.undo(), {
  container: recordGridTriggerSlot,
  onToggleGrid: () => toggleRecordGridView(),
  onStepBack: () => setHistoryOffset(historyOffset + 1),
  onStepForward: () => setHistoryOffset(historyOffset - 1),
});

const getToolState = () => ({
  tool: toolbar.getTool(),
  color: toolbar.getColor(),
  fontSize: toolbar.getFontSize(),
  lineWidth: toolbar.getLineWidth(),
  eraserRadius: toolbar.getEraserRadius(),
});

const canvasView = new CircularCanvas(canvasWrap, store, getToolState, {
  // タップした場所に入力欄を出す（ユーザー指示、issue #179）。以前はキーボード
  // 直上の中央へ固定していたが、visualViewport補正＋見えている範囲へのクランプ
  // （canvasView.ts openTextEditor参照）で「隠れる」こと自体は防げているため、
  // タップ位置追従に統一する。
  fixedBottomTextEditorOnCoarsePointer: false,
});

// 設定メニュー（テーマ・使い方・エクスポート）。以前は各タブの操作列
// （ツールバーの真上）にあったが、真ん中寄りで見つけにくい・他の操作ボタンと
// 並んで煩雑という指摘のため、画面左上（ヘッダー）へ固定で置くようにした
// （issue #161）。左上には元々「円相」というアプリ名を常時表示していたが、
// トリガーボタンと被るため、そちらはやめてポップオーバーの一番上に見出しとして
// 移した（buildTitleSection参照）。コンストラクタが自分自身をsettingsSlotへ
// 差し込む副作用だけが必要で、以後このインスタンス自体を参照することは無い。
const settingsSlot = document.querySelector<HTMLDivElement>("#settings-slot")!;
new SettingsMenu(
  settingsSlot,
  loadThemePreference(),
  loadCustomThemeHue(),
  (pref) => {
    saveThemePreference(pref);
    applyTheme(pref, loadCustomThemeHue());
  },
  (hue) => {
    saveCustomThemeHue(hue);
    applyTheme("custom", hue);
  },
  () => canvasView
);

// 過去めくり画面（E3-02〜04）：常時フルスクリーンの過去キャンバス
// （読み取り専用・ドラッグ元、ArchiveCanvas）へ切り替わる。本日のキャンバス
// （canvasView）は表示中ただ隠すだけで、DOM上の場所を動かしたりズーム・パンを
// 退避/固定/復元したりする必要は無い——ドロップ先は本日のキャンバスの実物では
// なく、ドラッグ中だけ画面右端にスライドインする単純な矩形のドロップ帯
// （ユーザー指示：本日の内容を事前に視覚的に確認できる必要はない）。
//
// 「今日→前の日→さらに前の日」と1日ずつ辿るだけの一方向ナビゲーション
// （一覧・カレンダー・検索は持たない）。historyOffsetは0=過去めくり画面では
// ない、1以上=「N日前」を表示中。
//
// 1日ずつ辿る◀▶操作は、以前はヘッダー右上の専用帯（#history-strip）が
// 持っていたが、「過去に戻る入口が過去めくり帯と記録一覧トリガーの2箇所に
// 分かれている」「深く過去へ潜った後、今日へ戻る手段が1日ずつ進む以外に無い」
// という指摘（Issue #3）を受け、道具バー脇の記録一覧トリガー（toolbar.ts
// buildRecordGridTrigger、main.tsのsyncRecordGridTrigger参照）へ統合した。
// ヘッダー（#history-strip）は表示中の日付を伝えるだけの受動的なラベルに
// なり、切り替え操作は一切持たない——トリガーは常にバッジの両脇に◀▶を
// 出しっぱなしにする（ユーザー指示：前日へ戻るボタンは今日を見ている間も
// 表示しておきたい）。◀（1日戻る）は常に有効、▶（1日進む）だけ今日を
// 見ている間disabledにする。記録一覧グリッド側も「今日」マスを実データの
// 有無に関わらず常にタップ可能にしてあり（recordGrid.ts buildTodayCell）、
// どれだけ過去へ潜っていてもグリッドを開いて今日のマスを押せば一発で戻れる。
//
// 帯（#history-strip）自体はキャンバスの外＝ヘッダーに置く固定要素のため、
// 画面幅に関わらずキャンバスへの重なりが無く、キャンバス自体は常に画面幅
// いっぱいまで広げられる（ユーザー指示）。今日は「今日」、それ以外は
// 「N月N日」を表示する（updateHistoryDateLabel参照）。
const historyView = document.querySelector<HTMLDivElement>("#history-view")!;
const historyDateLabel = document.querySelector<HTMLSpanElement>("#history-date-label")!;
const archiveCanvasWrap = document.querySelector<HTMLDivElement>("#archive-canvas-wrap")!;
const historyDropZone = document.querySelector<HTMLDivElement>("#history-drop-zone")!;
const recordGridViewEl = document.querySelector<HTMLDivElement>("#record-grid-view")!;
const recordGrid = new RecordGrid(recordGridViewEl);

/** 本体キャンバス・日付めくり・記録一覧の3画面切り替え（setActiveView）を、
 *  瞬時のhidden切り替えではなくフェードイン・フェードアウトにする
 *  （ユーザー指示）。同じ場所（#canvas-panel）を共有する3要素を同時に
 *  クロスフェードさせると、遷移中だけ2つが並んで表示されレイアウトが崩れる
 *  （.fade-visibleのCSSコメント参照）ため、旧を完全にフェードアウトさせ
 *  終わってから新をフェードインする逐次の入れ替えにする。 */
const canvasViewFade = createFadeVisibility(canvasWrap);
const historyViewFade = createFadeVisibility(historyView);
const recordGridViewFade = createFadeVisibility(recordGridViewEl);
function fadeControllerFor(view: PanelView): (show: boolean) => void {
  if (view === "canvas") return canvasViewFade;
  if (view === "history") return historyViewFade;
  return recordGridViewFade;
}

/** ドロップ帯のスライドイン/アウトのトランジション時間（style.cssの
 *  .history-drop-zoneのtransitionと揃える）。アニメーションが終わってから
 *  hidden属性を戻す（表示中は[hidden]で急に消えず、CSSのtransformで
 *  スライドアウトさせるため）。 */
const HISTORY_DROP_ZONE_TRANSITION_MS = 200;
let dropZoneHideTimer: ReturnType<typeof setTimeout> | null = null;

function showDropZone(): void {
  if (dropZoneHideTimer !== null) {
    clearTimeout(dropZoneHideTimer);
    dropZoneHideTimer = null;
  }
  historyDropZone.hidden = false;
  requestAnimationFrame(() => historyDropZone.classList.add("is-visible"));
}

function hideDropZone(): void {
  historyDropZone.classList.remove("is-visible", "is-hover");
  dropZoneHideTimer = setTimeout(() => {
    historyDropZone.hidden = true;
    dropZoneHideTimer = null;
  }, HISTORY_DROP_ZONE_TRANSITION_MS);
}

function isPointOverDropZone(clientX: number, clientY: number): boolean {
  const rect = historyDropZone.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

let historyOffset = 0;
let archiveCanvas: ArchiveCanvas | null = null;

/** `#canvas-panel`内で同じ場所に入れ替え表示する3つの画面（本体キャンバス／
 *  日付めくり／記録一覧）。常にどれか1つだけがhidden属性を持たない
 *  （setActiveView参照、ユーザー指示：3つを同じ場所で切り替える）。 */
type PanelView = "canvas" | "history" | "recordGrid";
let activeView: PanelView = "canvas";
/** 記録一覧を開く直前に表示していた画面（"canvas"か"history"のどちらか）。
 *  ×ボタン・Escapeで記録一覧を閉じた（＝日付を選ばずに戻る）場合、ここへ
 *  復元する——記録一覧トリガー（footer側、canvas-panelの外に常設）は
 *  日付めくり画面の途中でも押せるため、開く前の状態を1つ覚えておく必要がある
 *  （ユーザー指示：過去の記録グリッドの表示方式変更）。 */
let viewBeforeRecordGrid: PanelView = "canvas";
/** setActiveViewが「旧をフェードアウトし終えてから新をフェードインする」
 *  ために張る、フェードアウト完了待ちのタイマー。連打等でsetActiveViewが
 *  完了前にもう一度呼ばれた場合、前回分の「フェードインする」予約を
 *  取り消してから新しい行き先で仕切り直す——さもないと、古い呼び出しの
 *  コールバックが後から発火して直近の行き先を上書きしてしまう（過去に
 *  あったpendingViewRestoreの非同期競合と同種の問題、setHistoryOffset付近の
 *  コメント参照）。 */
let pendingViewTransition: ReturnType<typeof setTimeout> | null = null;

function historyDateKeyForOffset(offset: number): string {
  return shiftDateKey(dateKeyFor(new Date()), -offset);
}

function formatHistoryDateLabel(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${m}月${d}日`;
}

/** 過去めくり帯（#history-strip）の日付ラベルを、現在地（historyOffset）に
 *  合わせて更新する。今日（0）は「今日」固定表示、それ以外はN日前の日付。
 *  帯自体は画面幅に関わらず常時表示のため、setHistoryOffsetのたびに（今日
 *  ⇔過去どちらへの遷移でも）呼ぶ。 */
function updateHistoryDateLabel(): void {
  historyDateLabel.textContent =
    historyOffset === 0 ? "今日" : formatHistoryDateLabel(historyDateKeyForOffset(historyOffset));
}

/** 表示中の日付（historyOffset）に合わせて、アーカイブ側の内容を更新する。
 *  ArchiveCanvasインスタンス自体は初回だけ作り、以降はsetMemos()で中身だけ
 *  差し替える。 */
function syncHistoryPane(): void {
  const dateKey = historyDateKeyForOffset(historyOffset);
  const memos = loadArchive(dateKey);
  if (!archiveCanvas) {
    archiveCanvas = new ArchiveCanvas(archiveCanvasWrap, memos, {
      onDragStart: showDropZone,
      onDragMove: (clientX, clientY) => {
        historyDropZone.classList.toggle("is-hover", isPointOverDropZone(clientX, clientY));
      },
      onDrop: (memo, clientX, clientY) => {
        // ドロップ帯の上で離した場合だけ複製する。帯の外なら何もしない
        // （キャンセル）——store.insertCopy自体はドラッグ元（アーカイブ側）
        // のmemoを一切変更しない。
        if (isPointOverDropZone(clientX, clientY)) {
          store.insertCopy(memo);
        }
        hideDropZone();
      },
    });
  } else {
    archiveCanvas.setMemos(memos);
  }
}

/** 過去めくり画面の状態をURLへ反映する（?view=past&date=YYYY-MM-DD）。
 * 追加のホスティング設定（ルーティングのrewrite等）は不要——同じindex.html
 * 1枚に対するクエリ文字列の書き換えだけで完結する。history.replaceState
 * を使い（pushStateではない）、前の日/次の日を辿るたびに新しい閲覧履歴
 * エントリを作らない——以前あった`?view=shared`の仕組みと同じ方式
 * （README参照）。historyOffset===0（過去めくり画面ではない）の間は
 * view/dateどちらのパラメータも付けない。 */
function syncHistoryUrl(): void {
  const url = new URL(location.href);
  if (historyOffset > 0) {
    url.searchParams.set("view", "past");
    url.searchParams.set("date", historyDateKeyForOffset(historyOffset));
  } else {
    url.searchParams.delete("view");
    url.searchParams.delete("date");
  }
  history.replaceState(null, "", url);
}

/** URLに`?view=past&date=YYYY-MM-DD`が付いている場合、対応するhistoryOffset
 *  を返す（リロードしても過去めくり画面・めくっていた日付が維持されるように
 *  するため）。dateが不正な形式・今日以降（historyOffsetは1以上でなければ
 *  ならない——0は「今日」であり過去めくり画面の有効な状態ではない）の場合は
 *  nullを返し、通常表示から始める。 */
function readInitialHistoryStateFromUrl(): number | null {
  const params = new URLSearchParams(location.search);
  if (params.get("view") !== "past") return null;
  const dateParam = params.get("date");
  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return null;
  const offset = daysBetween(dateParam, dateKeyFor(new Date()));
  return offset >= 1 ? offset : null;
}

/** `#canvas-panel`内の3画面（本体キャンバス／日付めくり／記録一覧）の表示を
 *  差し替える唯一の入口。同じ画面への切り替えは何もしない（no-op）ため、
 *  setHistoryOffsetのように「今と違う時だけ」を呼び出し側が判定する必要は
 *  無い——ここ自身が判定する。本体キャンバスを離れる瞬間だけ
 *  finishTextEditingIfOpen()を呼び、記録一覧を離れる瞬間だけ
 *  recordGrid.deactivate()（リサイズ監視・キー捕捉の解除、フォーカス復元）を
 *  呼ぶ副作用をここに閉じ込める（ユーザー指示：過去の記録グリッドの表示方式
 *  変更——本体キャンバス⇔日付めくり⇔記録一覧を同じ場所で切り替える）。
 *
 *  瞬時のhidden切り替えではなく、旧をフェードアウトさせ終えてから新を
 *  フェードインする（ユーザー指示：3画面の切り替えをスムーズにしたい）。
 *  activeView自体はこの関数を呼んだ時点で即座に新しい行き先へ更新する——
 *  historyOffset同期（setHistoryOffset）やrecordGrid.deactivate()呼び出し等、
 *  「今どの画面に向かっているか」を参照する他のロジックが、フェード中の
 *  宙ぶらりんな状態を気にせず動けるようにするため。
 *
 *  冒頭の早期リターン（同じ画面への切り替えは何もしない）があるため、
 *  ここではフッターの記録一覧トリガー（syncRecordGridTrigger）を呼ばない
 *  ——過去めくり中に◀▶で日をまたいでもactiveViewは"history"のまま変わら
 *  ないため、ここに置くとその間トリガーのバッジ（曜日表示）だけ更新されず
 *  日付ラベルに追いつかなくなる不具合があった（ユーザー報告：日付の変更に
 *  曜日表示が間に合っていない）。呼び出し側（setHistoryOffset、
 *  toggleRecordGridView、handleRecordGridClose）がそれぞれ自分で呼ぶ。 */
function setActiveView(view: PanelView): void {
  if (activeView === view) return;
  if (pendingViewTransition !== null) {
    clearTimeout(pendingViewTransition);
    pendingViewTransition = null;
  }
  if (activeView === "canvas") canvasView.finishTextEditingIfOpen();
  if (activeView === "recordGrid") recordGrid.deactivate();
  fadeControllerFor(activeView)(false);
  activeView = view;
  pendingViewTransition = window.setTimeout(() => {
    pendingViewTransition = null;
    fadeControllerFor(view)(true);
    if (view === "recordGrid") recordGrid.activate(handleRecordGridClose);
  }, FADE_TRANSITION_MS);
}

/** 表示中の日付（historyOffset）を差し替える唯一の入口。呼び出し側（記録
 *  一覧トリガーの◀▶、記録一覧のセルタップ）は「次にいくつにしたいか」だけを
 *  渡す——「開く」「閉じる」という特別な動作は無く、1日戻る/進むの結果として
 *  表示が切り替わるだけ（ユーザー指示）。表示の切り替え自体はsetActiveViewに
 *  委ねるため、記録一覧を表示中にここが呼ばれても（セルタップ）正しく
 *  記録一覧→日付めくりへ直接遷移する。historyOffsetをsetActiveViewより先に
 *  更新する——末尾のsyncRecordGridTrigger()がトリガーのバッジに使う日付
 *  （currentTriggerDateKey）を、更新後の値で計算できるようにするため。
 *  setActiveViewの早期リターン（同じ画面内での日またぎ）に関わらず、
 *  historyOffsetが変わり得るここでは常にsyncRecordGridTrigger()を呼ぶ。 */
function setHistoryOffset(newOffset: number): void {
  historyOffset = newOffset;
  setActiveView(newOffset !== 0 ? "history" : "canvas");
  updateHistoryDateLabel();
  if (newOffset !== 0) syncHistoryPane();
  syncHistoryUrl();
  syncRecordGridTrigger();
}

/** フッターの記録一覧トリガー（toolbar.ts）に見せる、今表示している日付の
 *  キー——常にhistoryOffset（0=今日）が指す日そのもの。以前は今日を見ている
 *  間だけ「昨日」を見せていた（トリガーが実データを縮小プレビューしていた
 *  頃の名残——今日はまだarchiveされていないため）が、バッジ表示専用へ
 *  変えた（renderTriggerBadge参照）ことでその理由は無くなっており、逆に
 *  「日曜0時台なのに土曜の曜日バッジが出る」というズレとして見えてしまって
 *  いた（ユーザー指摘：今日の日付が正確に反映されていない）。
 *  historyDateKeyForOffset(0)は（-0日シフト＝そのまま）today自身と等しい
 *  ため、offset===0の特別扱いは不要——常にhistoryDateKeyForOffsetへ委ねる。 */
function currentTriggerDateKey(): string {
  return historyDateKeyForOffset(historyOffset);
}

/** フッターの記録一覧トリガーの見た目を、今の状態（historyOffset/
 *  activeView）に合わせて更新する。呼び出し側（setHistoryOffset、
 *  toggleRecordGridView、handleRecordGridClose）がhistoryOffsetまたは
 *  activeViewを変更するたびに自分で呼ぶ——setActiveView内には置かない
 *  （その冒頭の早期リターンにより、過去めくり中の日またぎで呼ばれずじまいに
 *  なる不具合があった、Issue #3）。▶（1日進む）は今日を見ている間
 *  （historyOffset===0）だけ非表示にする——◀（1日戻る）は今日を見ている
 *  間も含め常に表示・常に有効（ユーザー指示：前日へ戻るボタンは今日を
 *  見ている時も出しておきたい／進むボタンは今日を見ている時は無くていい）。
 *  記録一覧を開いている間は中央バッジを押下状態にする。 */
function syncRecordGridTrigger(): void {
  toolbar.refreshRecordGridTrigger(currentTriggerDateKey(), historyOffset > 0, activeView === "recordGrid");
}

/** 記録一覧トリガー（footerの独立カード、canvas-panelの外に常設のため
 *  本体キャンバス・日付めくりどちらの最中でも押せる）から呼ばれる、開閉
 *  トグル。×ボタンを持たない設計（ユーザー指示：iOS/Androidのアプリ切り替え
 *  画面のように、同じボタンをもう一度押すかマス以外の場所をタップして戻る）
 *  のため、「今記録一覧を表示中なら閉じる、そうでなければ開く」を1つの入口に
 *  まとめている。開く前に表示していた画面を覚えておき、日付を選ばずに閉じた
 *  場合はそこへ戻る（handleRecordGridClose参照）。 */
function toggleRecordGridView(): void {
  if (activeView === "recordGrid") {
    setActiveView(viewBeforeRecordGrid);
    syncRecordGridTrigger();
    return;
  }
  viewBeforeRecordGrid = activeView;
  setActiveView("recordGrid");
  syncRecordGridTrigger();
}

/** 記録一覧（recordGrid.ts）内でのマス以外のタップ・Escapeキー・セルタップが
 *  起きた時に一度だけ呼ばれる。dateKeyが非nullならセルタップ——
 *  setHistoryOffsetへそのまま渡し、日付めくり画面のその日を直接開く（記録
 *  一覧は索引役に徹する、ユーザー指示）。nullならマス以外のタップ／Escapeでの
 *  単純な取り消し——記録一覧を開く前の画面（viewBeforeRecordGrid、「直近で
 *  操作していたキャンバス」——本体キャンバスか、既に日付めくりで見ていた
 *  過去の日付か）へ戻る。toggleRecordGridViewが footer トリガーの
 *  再クリックで同じ場所へ戻すのと同じ考え方。 */
function handleRecordGridClose(dateKey: string | null): void {
  if (dateKey) {
    setHistoryOffset(daysBetween(dateKey, dateKeyFor(new Date())));
  } else {
    setActiveView(viewBeforeRecordGrid);
    syncRecordGridTrigger();
  }
}

// 起動時にURLへ過去めくり画面の状態が残っていれば、通常表示ではなく
// 直接その日付の過去めくり画面から始める。
const initialHistoryOffset = readInitialHistoryStateFromUrl();
if (initialHistoryOffset !== null) {
  setHistoryOffset(initialHistoryOffset);
} else {
  updateHistoryDateLabel();
}
// setHistoryOffset経由（上のtrue分岐）でもsetActiveView内から既に呼ばれて
// いるが、else分岐（今日のまま起動）はsetActiveViewを一切通らないため、
// フッターのトリガー初期表示をここで明示的に同期する。
syncRecordGridTrigger();

// 初回起動時は、使い方ページを自動でポップアップ表示する（ユーザー指示）。
// usageGuide.ts側のopen()がmarkUsageGuideSeen()を呼ぶため、一度でも見れば
// 以後は自動表示しない（設定メニュー内の「使い方」からはいつでも開ける）。
// showSkip=trueで、序の画面に「早く使いたい」（そのまま閉じる）も並べて
// 出す——設定メニューからの再視聴時は出さない（settingsMenu.ts参照）。
if (!loadUsageGuideSeen()) {
  openUsageGuide(undefined, true);
}

// 朝リセット（フォアグラウンド復帰時）：起動中はMemoStoreがlocalStorageの内容を
// メモリ上に保持し続けているため、performDailyResetIfNeeded()がlocalStorageを
// 書き換えるだけでは画面に反映されない。日付が変わっていた場合だけ、生きている
// storeの側もreplaceAll([])でlocalStorage（既に空にされている）と同期させる。
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (performDailyResetIfNeeded()) {
    store.replaceAll([]);
    maybeShowFirstResetHint();
    // 朝リセットで新しいarchive日付が増えた直後は、道具バー横のトリガー
    // （最新日のサムネイル）も古いままなので描き直す。
    syncRecordGridTrigger();
  }
});

function frame(): void {
  // 過去めくり画面が全面に出ている間、本日のキャンバス（canvasView）は隠れて
  // いるため描画しない——ArchiveCanvas側だけレンダリングする（無駄な描画
  // コストをかけない）。
  if (!canvasWrap.hidden) canvasView.render();
  if (archiveCanvas && !historyView.hidden) archiveCanvas.render();
  const zoomed = canvasView.isZoomed();
  const mobileTextEditing = canvasView.isEditingTextFixedBottom();
  // ヘッダー/ツールバーは画面全体に広がったキャンバスの上に固定オーバーレイ
  // として乗っているため、ズーム中（1倍より拡大）は下の絵が見えるよう薄くする
  // （style.css `#app.is-zoomed`、ユーザー指示）。
  app.classList.toggle("is-zoomed", zoomed);
  // モバイルでキーボード直上に固定表示される入力欄（issue #87）はツールバーと
  // ほぼ同じ場所に不透明なカードとして重なるため、表示中はツールバーを完全に
  // 隠す（style.css `#app.is-editing-text-mobile`、ユーザー指示）。
  app.classList.toggle("is-editing-text-mobile", mobileTextEditing);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
