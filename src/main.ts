import "./style.css";
import { CircularCanvas } from "./canvasView";
import { FIXED_LIFESPAN_DAYS } from "./fade";
import { MemoStore } from "./memoStore";
import { Toolbar } from "./toolbar";
import { RewindSelector } from "./rewindSelector";
import { AppearanceSelector } from "./appearanceSelector";
import { createFadeVisibility, FADE_TRANSITION_MS } from "./fadeVisibility";
import { buildFramePatternPicker } from "./framePattern";
import { setupControlPanelDrawer } from "./controlPanelDrawer";
import { ReviveInfoPill } from "./reviveInfoPill";
import { mountAccountWidget } from "./clerkAccount";
import { pushOp, refreshFromCloud, setTokenGetter, syncOnSignIn } from "./cloudSync";
import { connectRealtimeSync } from "./realtimeSync";
import { SettingsMenu } from "./settingsMenu";
import { SharedRoomMenu } from "./sharedRoomMenu";
import { SmuiView } from "./smuiView";
import {
  loadCustomThemeHue,
  loadFramePattern,
  loadFrameShape,
  loadPersonalFramePattern,
  loadThemePreference,
  loadUsageGuideSeen,
  saveCustomThemeHue,
  saveFramePattern,
  saveFrameShape,
  savePersonalFramePattern,
  saveThemePreference,
} from "./storage";
import { TemplatePicker } from "./templatePicker";
import { applyTheme } from "./theme";
import { openUsageGuide } from "./usageGuide";

// テーマ（自動/ライト/ダーク/好きな色）は、他の何よりも先に適用する——
// 後回しにすると一瞬ライトテーマで描画されてからダークへ切り替わる「ちらつき」
// が見えるため（ユーザー指示：設定ボタンを追加してテーマ変更機能を入れたい）。
applyTheme(loadThemePreference(), loadCustomThemeHue());

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <div class="app-header-left">
      <div id="settings-slot"></div>
    </div>
    <div class="app-header-right">
      <nav class="view-nav">
        <button type="button" class="view-nav-btn" data-view="canvas">個人</button>
        <button type="button" class="view-nav-btn" data-view="shared">共有</button>
      </nav>
    </div>
  </header>
  <main class="app-main">
    <div id="canvas-panel" class="view-panel fade-visible">
      <div id="canvas-wrap"></div>
      <div id="canvas-info-row" class="info-row"></div>
    </div>
    <div id="shared-panel" class="view-panel fade-visible" hidden></div>
  </main>
  <footer class="app-footer">
    <div class="control-panel">
      <div class="control-panel-body">
        <div id="primary-slot"></div>
        <button type="button" class="control-panel-handle" aria-label="色・振り返りの表示を切り替える" aria-expanded="false"></button>
        <div id="duration-slot" class="fade-visible"></div>
      </div>
    </div>
  </footer>
`;

// ログイン中は、ローカルの変更（描画・削除・移動など）が起きるたびに、触れた
// メモ単位でクラウド保存を予約する（連続する変更は短くデバウンスされ、まとめて
// 送られる、issue #99）。未ログイン時はsetTokenGetter(null)状態なのでpushOpは
// 何もしない。
const store = new MemoStore(undefined, true, (op) => pushOp(op));

// ログイン中は、他端末での変更をWebSocket通知で受け取り、その都度クラウドから
// 取得し直してローカルに反映する（＝ページを開いたままでも他端末の変更が自動で見える）。
// ログアウト時はdisconnectRealtimeを呼んで接続を切る。
let disconnectRealtime: (() => void) | null = null;
// 共有キャンバス（ルーム）を選んだ時、そのcanvasIdの変更通知を受け取れる
// ようにするための橋渡し。ログイン中だけ実体を持つ（SharedRoomMenuの
// onSelectRoomから呼ぶ。selectRoom自体はスクロールの都合でsmuiViewが持つ）。
let subscribeToRoom: ((canvasId: string) => void) | null = null;

// .app-footerの高さ（--app-footer-height）は、モバイル幅ではハンドルの開閉で
// 変わるようになった（style.css .control-panel-body参照）。共有タブの
// .info-row（見た目の設定・セッション開始等の行）がこの実測値を見てフッターの
// 裏に隠れないよう自分の位置を調整するため、実際の高さをResizeObserverで
// 追従させる（決め打ちの値だとハンドル開閉のたびにズレてしまう）。
const appFooterEl = document.querySelector<HTMLElement>(".app-footer")!;
const syncAppFooterHeightVar = () => {
  document.documentElement.style.setProperty("--app-footer-height", `${appFooterEl.getBoundingClientRect().height}px`);
};
new ResizeObserver(syncAppFooterHeightVar).observe(appFooterEl);
syncAppFooterHeightVar();

const canvasPanel = document.querySelector<HTMLDivElement>("#canvas-panel")!;
const canvasWrap = document.querySelector<HTMLDivElement>("#canvas-wrap")!;
const sharedPanel = document.querySelector<HTMLDivElement>("#shared-panel")!;
const primarySlot = document.querySelector<HTMLDivElement>("#primary-slot")!;
const durationSlot = document.querySelector<HTMLDivElement>("#duration-slot")!;
// 「残り時間」ピル（キャンバスタブ）: ツールバー直上の行に、共有タブの
// 「＋ルームを作成」等と同じ見た目で置く（ユーザー指示）。共有タブ側は
// smuiView自身が同じ行の中で持つ（getRoomMenuSlot()の横）。
const canvasInfoRow = document.querySelector<HTMLDivElement>("#canvas-info-row")!;
const canvasReviveInfoPill = new ReviveInfoPill(canvasInfoRow);

const onToolChange = () => {
  canvasView.closeWritingSession();
  canvasView.finishTextEditingIfOpen();
  smuiView.closeWritingSessions();
  smuiView.finishTextEditingIfOpen();
};
// 道具バー自体はキャンバス・共有の両画面で共通の1つのインスタンスを使い回す。
// テンプレート挿入は通常キャンバス専用（共有画面には「＋テンプレートを使用」
// を用意しない、issue #79ユーザー指示）で、選択画面自体もそのボタンからしか
// 開けない全画面の幕（開いている間はタブ切り替え不可）ため、常にcanvasViewへ
// 挿入すればよい。「戻る」は「今表示中の画面」に対して行う。
const toolbar = new Toolbar(
  primarySlot,
  onToolChange,
  (id) => canvasView.beginPlacingTemplate(id),
  () => {
    if (currentView === "shared") smuiView.undo();
    else canvasView.undo();
  }
);
// 「消えるまでの期間」は選べる仕様をやめ常に1日固定にした（fade.tsのFIXED_LIFESPAN_DAYS）
// ため、この枠は旧振り返りビューが持っていた「過去に遡って見る」スライダーとして
// 転用する（ユーザー指示）。個人キャンバス専用の機能なので、キャンバス表示中だけ
// 触れる（setDurationVisible参照）——共有キャンバスの描画には影響しない。
const onRewindChange = () => {
  const rewindAt = rewindSelector.getRewindAt();
  canvasView.setRewindAt(rewindAt);
  toolbar.setEnabled(rewindAt === null);
};
const rewindSelector = new RewindSelector(durationSlot, onRewindChange);

// スマホ幅では色/消しゴムサイズ・振り返りシークバーを上部ハンドルの
// タップ/ドラッグで一行展開する（ユーザー指示）。デスクトップ幅では
// .control-panel-bodyがdisplay:contentsになりハンドルも隠れるため、
// 常時呼んでおいて問題ない。
setupControlPanelDrawer(
  document.querySelector<HTMLDivElement>(".control-panel-body")!,
  document.querySelector<HTMLButtonElement>(".control-panel-handle")!
);

// 設定メニュー（上のSettingsMenuへのonOpenTemplatePicker）の「テンプレートを
// 使用」から開く全画面のテンプレート選択。空キャンバス中央の案内・道具バーへ
// 置く案も試したが、頻度の低い呼び出しとして最終的に設定メニューへ落ち着けた
// （ユーザー指示）。選ばれたテンプレートは道具バー経由でそのまま盤面に置く
// （道具をテキストに切り替える副作用も含めて、以前の道具バーのテンプレート
// ボタンとまったく同じ流れ）。キャンバス／共有のどちらのタブから開いても、
// 行き先の振り分けは上のToolbarのonInsertTemplateがcurrentViewを見て行う
// ため、選択画面自体は1つで足りる——全画面の幕がヘッダーのタブ切り替えごと
// 覆うので、開いている間にタブが変わることもない。
const templatePicker = new TemplatePicker((id) => toolbar.insertTemplate(id));

const getToolState = () => ({
  tool: toolbar.getTool(),
  color: toolbar.getColor(),
  lifespanDays: FIXED_LIFESPAN_DAYS,
  fontSize: toolbar.getFontSize(),
  lineWidth: toolbar.getLineWidth(),
  eraserRadius: toolbar.getEraserRadius(),
});

// 「＋テンプレートを使用」は道具バー側（onOpenTemplatePicker、上記）へ
// 試験的に移したため、空キャンバスの案内には渡さない——省略時は
// 「自由に書いてみる」の案内だけを出す（canvasView.ts参照）。
// frameStrokeWidthは既定(1px固定)のままだと、フレームの色（マット/べっ甲/
// クリア/木目、いずれも柄・質感を見せるパターン）を選んでもほぼ見えない
// （ユーザー指摘）ため、共有キャンバス（SMUI_FRAME_WEIGHT_RATIO、smuiView.ts）
// と同じくキャンバスサイズに比例した太さにする——ただし共有の太いウェリントン
// 風フレームほどは主張させず、控えめな比率にする。
const PERSONAL_FRAME_WEIGHT_RATIO = 0.02;
const personalFramePatternId = loadPersonalFramePattern();
// 実験中（方法A）：個人キャンバスを「片眼鏡」(frameKind:"monocle")にする案の
// 検証用。frameGeometry.ts/canvasView.tsのdrawHingeTabsが片側だけタブを描く
// （直接の呼び出し元はcanvasView.tsのrenderPair）——幾何形状(clip/clamp)自体は
// "single"と同じ丸/楕円/長方形をそのまま使うため、書き込み判定・サイズ計算は
// 変わらない。
// 片眼鏡のタブ+チェーン（frameGeometry.tsのdrawHingeTabs/drawMonocleChain）は
// 円の右側にframeStrokeWidth+タブぶんはみ出して描かれる。既定のcontentScaleFactor
// (0.43、fitCanvasToContainer参照)だと、正方形に近いコンテナ（幅=高さ、スマホ
// 幅など）では円の外側の余白がこのはみ出し分より狭く、チェーンが見切れて
// しまっていた（ユーザー指摘）。円自体をひとまわり小さく描いて余白を広げる。
const PERSONAL_CONTENT_SCALE_FACTOR = 0.36;
const canvasView = new CircularCanvas(canvasWrap, store, getToolState, {
  framePatternId: personalFramePatternId,
  frameStrokeWidth: (canvasSizePx) => canvasSizePx * PERSONAL_FRAME_WEIGHT_RATIO,
  frameKind: "monocle",
  contentScaleFactor: PERSONAL_CONTENT_SCALE_FACTOR,
  // タップした場所に入力欄を出す（ユーザー指示、issue #179）。以前はキーボード
  // 直上の中央へ固定していたが、visualViewport補正＋見えている範囲へのクランプ
  // （canvasView.ts openTextEditor参照）で「隠れる」こと自体は防げているため、
  // タップ位置追従に統一する。
  fixedBottomTextEditorOnCoarsePointer: false,
});

// 設定メニュー（テーマ・見た目の設定・テンプレート・使い方・エクスポートに
// 加え、アカウント区画を持つ）。以前は各タブの操作列（ツールバーの真上）に
// あったが、真ん中寄りで見つけにくい・他の操作ボタンと並んで煩雑という
// 指摘のため、画面左上（ヘッダー）へ固定で置くようにした（issue #161）。
// 左上には元々「円相」というアプリ名を常時表示していたが、トリガー
// ボタンと被るため、そちらはやめてポップオーバーの一番上に見出しとして
// 移した（buildTitleSection参照）——タブ切り替えでの置き場所の移動
// （旧moveTo()）はもう不要（常に#settings-slotに固定）。
// アカウント区画の枠にはmountAccountWidgetでClerkの中身（未ログイン時の
// ログインボタン／ログイン中のアカウント情報ボタン）を描き込む。
//
// 共有タブでルーム未選択の間は、プレースホルダーの空Storeを書き出し対象に
// してしまわないようnullを返す——ExportSection側はnullなら書き出さず
// エラー表示に留める。smuiView/currentViewはこの時点ではまだ定義されて
// いないが、このコールバックは書き出しボタンが押された時にだけ呼ばれる
// ため、それまでに定義が済んでいれば問題ない。
const settingsSlot = document.querySelector<HTMLDivElement>("#settings-slot")!;
const settingsMenu = new SettingsMenu(
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
  () => (currentView === "shared" ? (smuiView.hasSelectedRoom() ? smuiView : null) : canvasView),
  () => templatePicker.open()
);

// 「見た目の設定」区画(issue #154、ユーザー指示)。以前は個人キャンバスの操作列に
// 独立ボタン(FrameColorSelector)として置かれていたが、設定メニューの
// getAppearanceSlot()へ統合した。共有キャンバスAppearanceSelectorと同じ
// framePattern.tsの4種を、個人キャンバスにも色だけ（形は変更なし）で開放する
// （ユーザー指示）。この端末だけのローカル設定（storage.tsのloadPersonalFramePattern/
// savePersonalFramePattern、サーバー同期なし）。共有タブを見ている間は隠す
// （setView参照、初期表示はキャンバスタブなのでここでは何もしなくてよい）。
const personalPatternPicker = buildFramePatternPicker(personalFramePatternId, (id) => {
  savePersonalFramePattern(id);
  canvasView.setFramePattern(id);
});
settingsMenu.getAppearanceSlot().appendChild(personalPatternPicker.element);

void mountAccountWidget(settingsMenu.getAccountSlot(), (session) => {
  if (session) {
    setTokenGetter(session.getToken);
    void syncOnSignIn(store);
    const realtime = connectRealtimeSync(session, {
      onPersonalMemoUpserted: (memo) => store.applyRemoteUpsert(memo),
      onPersonalMemoDeleted: (memoId) => store.applyRemoteDelete(memoId),
      onSharedChanged: (canvasId) => smuiView.notifyRemoteChangeIfCurrent(canvasId),
      onSessionChanged: (canvasId, sessionState) => smuiView.notifySessionChanged(canvasId, sessionState),
      onHeatChanged: (canvasId, memoId, heat) => smuiView.notifyHeatChanged(canvasId, memoId, heat),
      onMemoUpserted: (canvasId, memo) => smuiView.notifyMemoUpserted(canvasId, memo),
      onMemoDeleted: (canvasId, memoId) => smuiView.notifyMemoDeleted(canvasId, memoId),
      onReconnected: () => {
        void refreshFromCloud(store);
        smuiView.notifyReconnected();
      },
    });
    disconnectRealtime = realtime.disconnect;
    subscribeToRoom = realtime.subscribeToRoom;
  } else {
    setTokenGetter(null);
    disconnectRealtime?.();
    disconnectRealtime = null;
    subscribeToRoom = null;
  }
});

// SMUI（眼鏡ビュー）: 「共有」タブ。個人キャンバスは含まず、大きな眼鏡形状1枚
// （左右レンズ+ブリッジが1つの連続領域）だけの共有キャンバスを表示する
// ——選んだ共有キャンバス（ルーム）のMemoStoreだけを扱う（個人MemoStoreの
// storeはcanvasViewにのみ渡す）。
// ルームの作成・選択（SharedRoomMenu）は、眼鏡キャンバスの下に埋め込む
// （smuiView.getRoomMenuSlot()、ユーザー指示）——smuiView自身がsharedPanelの
// hidden属性で他の2画面では自動的に隠れるため、個別のフェード処理は不要。
// 「見た目の設定」（AppearanceSelector）は設定メニューへ統合済み(issue #154、
// 下記のsettingsMenu.getAppearanceSlot()参照)。
let frameShapeId = loadFrameShape();
let framePatternId = loadFramePattern();
const smuiView = new SmuiView(sharedPanel, getToolState, frameShapeId, framePatternId, toolbar);
const toolbarEl = primarySlot.querySelector<HTMLElement>(".toolbar")!;

// 画面切り替え時、道具バー・振り返りスライダーをふわっとフェードイン／
// フェードアウトさせる（ユーザー指示）。
const setToolbarVisible = createFadeVisibility(toolbarEl);
const setDurationVisible = createFadeVisibility(durationSlot);
// キャンバス本体（#canvas-panel等）も、下部バーと同じくふわっとフェードイン／
// フェードアウトさせる（ユーザー指示：キャンバスも下部バーと同様に滑らかに
// 切り替えたい）。2つのパネルは#app-main内で横並びのflexアイテムのため、
// 下部バーと同じ理由（新旧が同時に表示されるとレイアウトが崩れる）で、
// クロスフェードではなく逐次の入れ替えにする——setView()参照。
const setCanvasPanelVisible = createFadeVisibility(canvasPanel);
const setSharedPanelVisible = createFadeVisibility(sharedPanel);
// 初期表示（キャンバス）ではフェードインさせず、最初から見えている状態にする。
toolbarEl.classList.add("is-visible");
durationSlot.classList.add("is-visible");
canvasPanel.classList.add("is-visible");

// 「見た目の設定」区画の共有キャンバス側の中身(issue #154)。以前は共有タブの
// 操作列に独立ボタンとして置かれていたが、設定メニューのgetAppearanceSlot()
// (個人用のpersonalPatternPickerと同じ場所)へ統合した——タブ切り替えのたび
// どちらか一方だけをhiddenで出す(setView参照)。ここでは共有タブが初期表示
// ではないため、構築直後はhiddenにしておく。
const appearanceSelector = new AppearanceSelector(
  frameShapeId,
  framePatternId,
  (id) => {
    frameShapeId = id;
    saveFrameShape(id);
    smuiView.setFrameShape(id);
  },
  (id) => {
    framePatternId = id;
    saveFramePattern(id);
    smuiView.setFramePattern(id);
  },
  // 「メガネ2」(issue #113④)はルーム・組専用の上書きで、個人のローカル既定値
  // (loadFrameShape/loadFramePattern)には影響しない——「メガネ1」と違いsaveFrame*
  // を呼ばない。
  (id) => smuiView.setPair2FrameShape(id),
  (id) => smuiView.setPair2FramePattern(id)
);
appearanceSelector.element.hidden = true;
settingsMenu.getAppearanceSlot().appendChild(appearanceSelector.element);

// 共有キャンバス（ルーム）の作成・選択・招待リンクのメニュー。招待リンク経由の
// 自動参加（?join=...）は表示中の画面と無関係に裏で動くため、ボタン自体は
// 常に生成しておく。
new SharedRoomMenu(
  smuiView.getRoomMenuSlot(),
  (id) => {
    subscribeToRoom?.(id);
    void smuiView.selectRoom(id);
  },
  () => setView("shared"),
  // 招待リンク経由のログイン不要のゲスト参加(issue #79)。Clerkのsession(=
  // AuthSession)を持たないため、payload.tokenGetterをゲストトークンだけ
  // 返すダックタイプのオブジェクトに差し替えて、mountAccountWidgetの
  // ログイン時と同じconnectRealtimeSyncの配線をそのまま流用する。
  (canvasId, guestAuth) => {
    const realtime = connectRealtimeSync(
      { getToken: async () => guestAuth.token },
      {
        onPersonalMemoUpserted: () => {},
        onPersonalMemoDeleted: () => {},
        onSharedChanged: (cid) => smuiView.notifyRemoteChangeIfCurrent(cid),
        onSessionChanged: (cid, sessionState) => smuiView.notifySessionChanged(cid, sessionState),
        onHeatChanged: (cid, memoId, heat) => smuiView.notifyHeatChanged(cid, memoId, heat),
        onMemoUpserted: (cid, memo) => smuiView.notifyMemoUpserted(cid, memo),
        onMemoDeleted: (cid, memoId) => smuiView.notifyMemoDeleted(cid, memoId),
        onReconnected: () => smuiView.notifyReconnected(),
      }
    );
    disconnectRealtime = realtime.disconnect;
    subscribeToRoom = realtime.subscribeToRoom;
    subscribeToRoom(canvasId);
    void smuiView.selectRoom(canvasId);
    setView("shared");
  }
);

// --- 画面切り替え -------------------------------------------------------
let currentView: "canvas" | "shared" = "canvas";
// 共有タブでは振り返りシークバー(#duration-slot)を表示しない（下記setView
// 参照）ため、その分の余白を色/消しゴムサイズブロックへ回せるよう、
// style.cssがbody[data-view]を見て判定できるようにしておく。
document.body.dataset.view = currentView;

// キャンバス／共有タブをURLに反映する。パス（例: /shared）ではなくクエリ
// パラメータにしているのは、静的ホスティング（Vercel/Netlify/GitHub Pages等、
// README参照）によってはSPAのパスをindex.htmlへフォールバックさせる設定が
// 無く、/sharedを直接開く・リロードすると404になりかねないため——クエリ
// パラメータなら常に同じindex.htmlが返るのでその心配がない。
const VIEW_PARAM = "view";

function readInitialView(): "canvas" | "shared" {
  return new URLSearchParams(location.search).get(VIEW_PARAM) === "shared" ? "shared" : "canvas";
}

// 「共有」タブにいる間にリロードすると「キャンバス」タブへ戻ってしまい
// 不便、というユーザー指摘の対応。canvasの時はパラメータ自体を消して
// URLを素のままにする（joinパラメータの扱いと同じ考え方、sharedRoomMenu.ts参照）。
function syncViewUrl(view: "canvas" | "shared"): void {
  const url = new URL(location.href);
  if (view === "shared") url.searchParams.set(VIEW_PARAM, "shared");
  else url.searchParams.delete(VIEW_PARAM);
  history.replaceState(null, "", url);
}

/**
 * 画面（キャンバス／共有）を切り替える。下部バーの中身（道具バー・振り返り
 * スライダー）は、今の中身を完全にフェードアウトさせてから、新しい中身に
 * 丸ごと入れ替えてフェードインさせる（ユーザー指示）。
 */
function setView(view: "canvas" | "shared"): void {
  if (view === currentView) return;
  canvasView.finishTextEditingIfOpen();
  // 振り返りスライダーは個人キャンバス専用の機能。共有タブへ移る間、
  // 遡ったままだと道具バーが無効化されたまま戻らなくなってしまう
  // （道具バーはキャンバス・共有の両タブで共通の1つのインスタンスのため）
  // ので、キャンバスタブを離れる時点で「たった今」に戻しておく。
  if (currentView === "canvas") rewindSelector.reset();
  currentView = view;
  document.body.dataset.view = view;
  syncViewUrl(view);
  document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
    btn.dataset.active = String(btn.dataset.view === view);
  });

  // まず今表示しているキャンバス本体・下部バー・ヘッダーの中身を丸ごと
  // フェードアウトさせる（ユーザー指示：キャンバスも下部バーと同様に滑らかに
  // 切り替えたい）。hidden属性を戻すのはフェード完了後（createFadeVisibility内の
  // タイマー）なので、ここではまだ外していない側のパネルは見えたまま薄くなっていく。
  setCanvasPanelVisible(false);
  setSharedPanelVisible(false);
  setToolbarVisible(false);
  setDurationVisible(false);
  smuiView.setActive(false);

  window.setTimeout(() => {
    // フェードアウト待ちの間にさらに別の画面へ切り替えられていた場合は、
    // 古い方のフェードインは行わない（最後に呼ばれた切り替えだけを反映する）。
    if (currentView !== view) return;
    setCanvasPanelVisible(view === "canvas");
    setSharedPanelVisible(view === "shared");
    // 道具バーはキャンバス表示中に加え、SMUI（共有）の左右レンズでも描画に
    // 使うため表示する。振り返りスライダーは個人キャンバス専用なのでキャンバス
    // 表示中だけ出す。
    setToolbarVisible(view === "canvas" || view === "shared");
    // 「テンプレートを使用」（設定メニュー内）は個人キャンバス専用（issue #79ユーザー指示）。
    settingsMenu.setTemplateSectionVisible(view === "canvas");
    // 「見た目の設定」（設定メニュー内、issue #154）は個人・共有で中身が違うため、
    // 今表示中のタブの側だけを見せる。
    personalPatternPicker.element.hidden = view !== "canvas";
    appearanceSelector.element.hidden = view !== "shared";
    setDurationVisible(view === "canvas");
    smuiView.setActive(view === "shared");
  }, FADE_TRANSITION_MS);
}

document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view as "canvas" | "shared"));
});

const initialView = readInitialView();
// 既定（キャンバス）はフェードなしで即座に反映する。#canvas-panel・道具バー・
// 振り返りスライダーはテンプレート側の初期状態（hiddenなし）＋既にis-visibleを
// 付けてあるので、ここではナビの見た目だけ揃える。URLが共有タブを指している
// 場合だけ、setViewと同じ処理で切り替える（ユーザー指示：共有タブでリロード
// してもキャンバスに戻らないようにしたい）。
document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
  btn.dataset.active = String(btn.dataset.view === "canvas");
});
if (initialView === "shared") setView("shared");

// 初回起動時は、使い方ページを自動でポップアップ表示する（ユーザー指示）。
// usageGuide.ts側のopen()がmarkUsageGuideSeen()を呼ぶため、一度でも見れば
// 以後は自動表示しない（設定メニュー内の「使い方」からはいつでも開ける）。
// showSkip=trueで、序の画面に「早く使いたい」（そのまま閉じる）も並べて
// 出す——設定メニューからの再視聴時は出さない（settingsMenu.ts参照）。
if (!loadUsageGuideSeen()) {
  openUsageGuide(undefined, true);
}

function frame(): void {
  const now = Date.now();
  store.tick(now);
  let zoomed = false;
  let mobileTextEditing = false;
  if (currentView === "canvas") {
    canvasView.render(now);
    canvasReviveInfoPill.update(canvasView.getHoverRemainingMs(now));
    zoomed = canvasView.isZoomed();
    mobileTextEditing = canvasView.isEditingTextFixedBottom();
  }
  if (currentView === "shared") {
    smuiView.render(now);
    // ルーム接続中は見た目の設定を同期する——編集可能な全ユーザーに開放されて
    // いるため(issue #113④)、以前のようにルームマスター限定ではなく、定員超過の
    // 観覧者だけロックする。ルームの値をAppearanceSelectorの表示にも反映する。
    // setLocked/setValuesは値が変わらない限りDOMを触らないので、毎フレーム
    // 呼んでも無駄がない。「メガネ2」タブは、共同アイデア出しでレンズ分割が
    // 2組になっている間だけ表示する(pair2Available)。
    const appearanceSync = smuiView.getAppearanceSync();
    if (appearanceSync) {
      appearanceSelector.setLocked(appearanceSync.locked);
      appearanceSelector.setValues(appearanceSync.shapeId, appearanceSync.patternId);
      appearanceSelector.setPair2Visible(appearanceSync.pair2Available);
      if (appearanceSync.pair2Available) {
        appearanceSelector.setPair2Values(appearanceSync.pair2ShapeId, appearanceSync.pair2PatternId);
      }
    } else {
      appearanceSelector.setLocked(false);
      appearanceSelector.setPair2Visible(false);
    }
    zoomed = smuiView.isZoomed();
    mobileTextEditing = smuiView.isEditingTextFixedBottom();
  }
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
