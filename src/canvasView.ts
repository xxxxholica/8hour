import { createFadeVisibility } from "./fadeVisibility";
import { FrameGeometry } from "./frameGeometry";
import { circleIntersectsBox, clampBoxCenter, isInsideClamp, pointNearStrokes } from "./geometry";
import { drawRadialGlow, renderMemoAt } from "./memoRenderer";
import type { MemoStore } from "./memoStore";
import { drawRuledPaper } from "./paper";
import {
  fontPxForRender,
  LINE_HEIGHT_MULTIPLIER,
  measureTextBoxWidthPx,
  normalizedBoxSize,
  TEXT_FONT_FAMILY,
  wrapTextAtReferenceScale,
} from "./textLayout";
import { REFERENCE_RADIUS } from "./toolStyle";
import type { ToolbarTool } from "./toolbar";
import type { Memo, Point, TextMemo } from "./types";

const CENTER_DOT = "oklch(22% 0.012 55 / 0.18)";
const TRACE_GLOW = "oklch(22% 0.012 55 / 0.14)";
/** 空のキャンバスの案内（.canvas-empty-state、DOM側）を、円の中心からどれだけ
 *  下にずらして置くか（正規化単位）。以前canvasに直接fillTextしていたときと
 *  同じ位置。 */
const EMPTY_STATE_OFFSET_Y = 0.32;
/** 空のキャンバスの案内文（.canvas-empty-hint）の候補。表示のたびに1つを
 *  ランダムに選ぶ（syncEmptyState参照、ユーザー指示）。 */
const EMPTY_STATE_HINTS = [
  "気になることをメモしてみよう",
  "落書き感覚でひとこと残してみよう",
  "食べたいものを記録してみよう",
  "明日の予定をまとめてみよう",
  "ひらめきをそのまま置いてみよう",
  "あ、これあとでやらなきゃ…",
  "思いついた。忘れる前に書いとこ",
  "とりあえずここに下書き…",
  "サクッと書いておく？",
  "気になったもの、メモメモ",
];
/** 次の文言に切り替わるまで、今の文言をそのまま（フェードなしで）表示し続ける時間。 */
const EMPTY_STATE_HINT_VISIBLE_MS = 6000;
/** フェードアウトそのものにかける時間（ユーザー指示）。素早く消えるのではなく、
 *  ゆっくり薄れて消える見た目にする。opacityの遷移時間はJS側（rotateEmptyStateHint）
 *  からstyle.transitionDurationとして都度渡すため、CSS側には固定のtransition
 *  durationを書いていない（transition-property/timing-functionのみ、style.css参照）。 */
const EMPTY_STATE_HINT_FADE_OUT_MS = 5000;
/** 差し替え後、次の文言をタイプライターのように1文字ずつ打ち込んで見せる際の
 *  1文字あたりの間隔（ユーザー指示）。 */
const EMPTY_STATE_HINT_TYPE_MS = 100;

/** exclude（今表示中の文言）以外から1つ選ぶ。切り替え時に同じ文言が
 *  連続して出ないようにする。 */
function pickRandomEmptyStateHint(exclude?: string | null): string {
  const pool = exclude ? EMPTY_STATE_HINTS.filter((h) => h !== exclude) : EMPTY_STATE_HINTS;
  return pool[Math.floor(Math.random() * pool.length)];
}
const ERASER_CURSOR = "oklch(22% 0.012 55 / 0.3)";
/** 消しゴムの当たり範囲プレビュー円の内側の塗り。以前は輪郭線のみで内側が
 *  完全に透明だったため、実際に消える範囲がひと目で分かりづらかった
 *  （ユーザー指摘）。薄いグレーで軽く塗ることで範囲を分かりやすくする——
 *  紙・インクどちらの色の上でも同じように見えるよう、ink/paperのどちらの
 *  トークンにも依存しない中立なグレーの半透明にする。 */
const ERASER_CURSOR_FILL = "oklch(55% 0 0 / 0.16)";

/** 画面ピクセルでの当たり判定の許容範囲。円のサイズが変わっても指先の精度感が一定になるよう、
 *  実際に使うときは現在の半径で正規化してから比較する（normalizedThreshold = PX / radius）。 */
const HIT_THRESHOLD_PX = 12;
/** 書き終えてから何 ms 操作がなければ「同じメモへの継続」を打ち切るか */
const WRITING_SESSION_IDLE_MS = 1400;
/** ピンチズームの倍率の範囲。1未満（フィット範囲より縮小して余白を見せる）は
 *  意味がないため許可しない。上限は、キャンバス要素がヘッダー/ツールバーの
 *  下まで広がった（issue #83）後、最大までズーム+パンした時にその下まで
 *  確実に絵が届くよう2倍から引き上げた（ユーザー指摘：2倍だとギリギリ
 *  届かないことがある）。 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

/**
 * モバイルの複数指タップ（issue #90：2本指=直前の操作の取り消し(undo)、
 * 3本指=やり直し(redo)、GoodNotes等のノートアプリで一般的なジェスチャー）
 * の判定に使うしきい値。ピンチズームは「選択」道具の間だけ始まる
 * （beginPinch/onGlobalPointerDownのコメント参照）が、複数指タップの判定
 * 自体は道具に関わらず常に行う——undo/redoはどの道具を選んでいても使いたい
 * 操作のため。
 * TAP_MAX_MOVEMENT_PXは、指が触れてから離れるまでの間にこれを超えて動いたら
 * 「タップ」ではなくドラッグ（ピンチ・パン、または各道具の通常操作）とみなす。
 * TAP_MAX_DURATION_MSは、この一連のマルチタッチ（最初の指が触れてから、
 * 関わった指が全て離れるまで）の最大時間（ms）——長押しや、1本の指で長く
 * 描き続けている間に別の指が一瞬触れた、といったケースはタップとみなさない
 * （後者は、最後まで描き続けているその指自体がこの時間を超えるため自然に
 * 除外される）。
 */
const TAP_MAX_MOVEMENT_PX = 12;
const TAP_MAX_DURATION_MS = 400;

function pointerDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerMidpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** ソフトウェアキーボードが出るデバイス（openTextEditorのモバイル向け固定
 *  配置分岐、issue #87）かどうかの判定。画面幅ではなくポインタ精度で見るのは、
 *  iPad等の広い画面のタッチデバイスも対象に含めたいため。 */
function isCoarsePointerDevice(): boolean {
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

/** 進行中のピンチ操作の起点（開始時の指間距離・中点・その時点のズーム/パン）。 */
interface PinchState {
  startDist: number;
  startZoom: number;
  startMid: Point;
  startPan: Point;
}

export interface ToolState {
  tool: ToolbarTool;
  color: string;
  /** 基準円(半径340px)におけるフォントサイズ(px)。テキストツールの時のみ使う。 */
  fontSize: number;
  /** 基準円(半径340px)におけるペンの線の太さ(px)。ペン道具の時のみ使う。 */
  lineWidth: number;
  /** 消しゴムの当たり判定半径（画面px、キャンバスの大きさに関わらず一定）。
   *  消しゴム道具の時のみ使う（ユーザー指示：GoodNotesのようにバーで変えたい）。 */
  eraserRadius: number;
}

interface DrawState {
  mode: "idle" | "drawing" | "erasing" | "moving" | "pinching";
  activeMemoId: string | null;
  /** 移動道具でドラッグ中のメモID。ドラッグ中はポインタが動くたびに差分移動を積む。 */
  movingMemoId: string | null;
  idleTimer: number | null;
  lastPoint: Point | null;
}

/**
 * メモの座標は「円の半径を1とする正規化座標」で保存する（中心が原点、
 * 円周上が距離1）。こうしておくとウィンドウサイズが変わって円の物理的な
 * 大きさ（px）が変化しても、既存のメモが縮んで見えたり位置がずれたりしない
 * ——ウィンドウを広げれば単純にその分だけ拡大して描かれる。
 */
export interface CircularCanvasOptions {
  /** キャンバスの枠のサイズに対する割合。省略した場合はfitCanvasToContainer
   *  の既定値（固定0.43）を使う。 */
  contentScaleFactor?: number | ((size: number) => number);
  /** computeSquareSize（canvasSizing.ts）の下限をMIN_CANVAS_SIZE(200px)から
   *  差し替える。使い方ページの練習用サンドボックス（tutorialSandbox.ts）
   *  専用——本物のMIN_CANVAS_SIZEのままだと、CSS側でコンテナをそれより
   *  小さく（.tutorial-sandbox-canvas-wrap、style.css）縮めても、この下限が
   *  優先されてcanvas要素がコンテナの外へはみ出し、下の説明文と重なって
   *  見えてしまう（ユーザー報告）。省略時は本物と同じMIN_CANVAS_SIZE。 */
  minCanvasSizePx?: number;
  /** falseの場合、ポインタ操作を一切受け付けない。既定true。 */
  interactive?: boolean;
  /** text-editor-overlay（.text-editor-overlay、既定z-index:20）の実際のz-indexを
   *  呼び出し側で上書きする。全画面モーダル（テンプレート選択・使い方ページ、
   *  いずれもz-index 40番台）は「モーダルの中の本物のキャンバスへ書きかけの
   *  テキストが残っていても隠す」という前提でtext-editor-overlayより上に
   *  意図して設計されているが、使い方ページの練習用サンドボックス
   *  （tutorialSandbox.ts）はモーダルの内側で本物のテキスト入力を体験させる
   *  ため、逆にモーダル自身（z-index 41）より前面に出す必要がある。 */
  textEditorZIndex?: number;
  /** text-editor-overlayの画面上の幅の下限(px)。既定の幅計算
   *  （openTextEditorのwidthMeasureFontSize・resizeToContent参照）は、
   *  「表示上のfont-sizeは16px未満に落とさない」補正の分だけ基準スケールの
   *  文字サイズを引き上げて測るが、その測定結果（基準円スケールでの
   *  px、MIN〜MAX_TEXT_BOX_WIDTH_PXの範囲）を画面pxへ変換する際は実際の
   *  effectiveScale()をそのまま掛けるため、本物のキャンバスでは起きない
   *  ほど半径が小さい（使い方ページの練習用サンドボックス、
   *  tutorialSandbox.ts）場合、変換後の画面幅が1〜2文字ぶんしかない
   *  極端に細い入力欄になってしまう（ユーザー報告：入力欄が下の説明文と
   *  重なって見える——1文字ずつ縦に折り返された結果、タップ位置から
   *  下へ何行分も伸びてしまうため）。省略時は下限なし（本物と同じ挙動）。 */
  textEditorMinWidthPx?: number;
  /** 粗いポインター（主にスマホ）で入力欄をキーボード直上へ固定するか。
   *  省略時はtrue。本体では画面のリサイズやパンに強い固定表示を使う一方、
   *  練習用の小さな円ではタップ位置との対応を見せるためfalseにできる。 */
  fixedBottomTextEditorOnCoarsePointer?: boolean;
  /** テキストメモ描画時の最小フォントサイズ。練習画面では入力欄と同じ16pxに揃える。 */
  minRenderedTextFontPx?: number;
  /** メモ作成時刻の供給元。省略時は実時間。練習画面は加速した仮想時計を渡す。 */
  nowProvider?: () => number;
}

export class CircularCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = Math.max(1, window.devicePixelRatio || 1);
  private resizeObserver: ResizeObserver;
  /** フレーム形状・サイズ計算・縁取りの描画をまとめて持つ（canvasView.tsが
   *  肥大化したための整理、Refactor。src/frameGeometry.ts参照）。 */
  private frame: FrameGeometry;
  private interactive: boolean;
  private state: DrawState = {
    mode: "idle",
    activeMemoId: null,
    movingMemoId: null,
    idleTimer: null,
    lastPoint: null,
  };

  public getToolState: () => ToolState;
  private container: HTMLElement;
  private store: MemoStore;
  private textEditor: HTMLTextAreaElement | null = null;
  /** 開いているtext-editor-overlayを、フレームの状態（centerPx/scale/viewPan）が
   *  変わるたびに正しい画面位置へ再配置するための関数（openTextEditorが設定・
   *  閉じるときにnullへ戻す）。モバイルでキーボードが開くとcontainerの実サイズが
   *  変わりResizeObserverが発火するが、オーバーレイの位置はopenTextEditor実行時
   *  一度きりの計算のままだったため、タップした位置から離れた所に表示される
   *  不具合があった（ユーザー指摘）。ResizeObserverのコールバックからこれを
   *  呼び直すことで、フレームが動いてもオーバーレイを追従させる。 */
  private repositionTextEditor: (() => void) | null = null;
  /** openTextEditorがhtml/bodyのoverflowを固定している間、元の値に戻すための関数
   *  （閉じるときにnullへ戻す）。理由はopenTextEditor内のコメント参照。 */
  private restoreBodyScroll: (() => void) | null = null;
  /** 空のキャンバスに重ねる案内（「自由に書いてみる」）。ボタンとして押せる・
   *  読み上げられる必要があるため、canvasへの描画ではなく本物のDOMで持つ。
   *  interactive:falseのプレースホルダーでは作らない（nullのまま）。 */
  private emptyStateEl: HTMLElement | null = null;
  private emptyStateHintEl: HTMLElement | null = null;
  private setEmptyStateVisible: ((show: boolean) => void) | null = null;
  private emptyStateShown = false;
  /** 案内文をEMPTY_STATE_HINT_VISIBLE_MSだけ表示した後、フェードアウトを
   *  開始するまでの1回限りのタイマー。案内が表示されている間だけ動かす
   *  （startEmptyStateHintRotation/stopEmptyStateHintRotation参照）。 */
  private emptyStateHintHoldTimer: ReturnType<typeof setTimeout> | null = null;
  /** フェードアウトが終わってテキストを差し替える1回限りのタイマー。案内が
   *  消える・破棄されるタイミングで取り残さないようstopEmptyStateHintRotationで
   *  一緒に消す。 */
  private emptyStateHintFadeTimer: ReturnType<typeof setTimeout> | null = null;
  /** 差し替え後の文言を1文字ずつ打ち込んで見せる間のタイマー。同上の理由で
   *  stopEmptyStateHintRotationで一緒に消す。 */
  private emptyStateHintTypeTimer: ReturnType<typeof setInterval> | null = null;
  /** 消しゴムツールでの当たり範囲プレビュー用（ユーザー指示：クリックして実際に
   *  消し始めるまで、消しゴムの大きさが分からない問題を解消したい）。上のhoverInfo
   *  と同じ理由でmouseの間だけ、実際に消し始める前（mode==="idle"）に更新する
   *  ——タッチには「押さずに触れる」状態が無いため、そもそも事前確認ができない。
   *  実際に消している最中（mode==="erasing"）のカーソル表示はstate.lastPoint
   *  を使う既存の仕組みのままなので、ここでは触らない。 */
  private eraserHoverPoint: Point | null = null;
  /** マウスカーソルが現在フレーム（円/長方形等）の輪郭の内側にあるか。横長の
   *  ウィンドウでは円フレームの左右に余白ができ、その余白は<canvas>要素としては
   *  範囲内でも実際には描画・操作できない——render()でのカーソル形状の決定に使い、
   *  余白の上では道具に応じた形状(crosshair/grab)ではなく既定のカーソルに戻す
   *  （不具合報告：円の外でもカーソルが描画用に変化してしまう）。onPointerMoveで
   *  クランプ前の生の座標(isInsideClamp)を使って更新する。 */
  private pointerInsideFrame = true;
  /** 今の1回のジェスチャー（1回のドラッグでの描画・消去・移動・振り回し、
   *  または1回のテキスト編集セッション）の中で、undo履歴用のスナップショット
   *  （store.snapshotForUndo()）を既に積んだかどうか（issue #89）。
   *  onPointerDown・openTextEditorでfalseに戻し、ジェスチャー中で最初に
   *  ストアを書き換える直前だけtrueにして呼ぶ——ポインタが動くたびに何度も
   *  積んでしまうと、1回のドラッグが何十もの細かいundoステップに分かれて
   *  しまうため。 */
  private undoSnapshotTaken = false;
  /** 1本指ジェスチャー（描画・消しゴム・なぞる・移動）を今進行させている
   *  ポインタのid（nullなら未使用）。キャンバス要素上のpointerdownでのみ
   *  設定される——ピンチ中はbeginPinch()がnullに戻し、以後の1本指ジェス
   *  チャーの開始・継続を無効化する。 */
  private activePointerId: number | null = null;
  /** ブラウザ純正のページズームに頼らず、キャンバス自体を2本指でピンチ
   *  ズーム・パンできるようにする（ユーザー指示：スマホでのUX改善。さらに
   *  「キャンバスの外側どこでタッチしても構わない」という指示により、
   *  canvas要素にのみ登録されたactivePointerIdとは別に、windowレベルで
   *  すべてのpointerdown/move/up/cancelを監視して集める）。pointerIdごとの
   *  現在位置に加え、複数指タップ判定（issue #90、tapGesture*参照）に使う
   *  「触れた瞬間の位置」も持つ——2本目の指が乗るとピンチ開始（「選択」道具の
   *  間だけ、onGlobalPointerDown参照）。 */
  private pinchPointers = new Map<number, { pos: Point; downPos: Point }>();
  private viewZoom = 1;
  private viewPan: Point = { x: 0, y: 0 };
  /** 直前にResizeObserverのコールバックを処理した時点のコンテナの実サイズ。
   *  過去めくり画面の開閉でcanvasWrap.hiddenを切り替えると、コンテナが
   *  display:noneになって0x0を経由してからまた元のサイズに戻るだけの
   *  ケースでもResizeObserverは発火する。そのたびにviewZoom/viewPanを
   *  リセットすると、過去めくり画面を開くだけでズーム・パンが消えてしまう
   *  （ユーザー報告）。実際に幅・高さが変わった場合だけリセットするための
   *  比較用に保持する。初期値nullは「まだ一度も計測していない」を表し、
   *  初回のresizeObserver発火（監視開始直後、必ず1回は呼ばれる）ではリセット
   *  扱いになるが、その時点のviewZoom/viewPanは既にコンストラクタの初期値
   *  （1・原点）のままなので実害は無い。 */
  private lastContainerSize: { width: number; height: number } | null = null;
  private pinch: PinchState | null = null;
  /** 複数指タップ（issue #90）の判定用。一連のマルチタッチ（最初の指が触れて
   *  から関わった指が全て離れるまで）で同時に触れていた指の最大本数。 */
  private tapGesturePeakCount = 0;
  /** 上と同じ一連のマルチタッチの中で、いずれかの指がTAP_MAX_MOVEMENT_PXを
   *  超えて動いた（＝タップではなくドラッグ）場合はfalseになる。 */
  private tapGestureValid = true;
  /** 今回の一連のマルチタッチが始まった時刻（最初の指が触れた瞬間）。 */
  private tapGestureStartAt = 0;
  private textEditorZIndex: number | undefined;
  private textEditorMinWidthPx: number | undefined;
  private fixedBottomTextEditorOnCoarsePointer: boolean;
  private minRenderedTextFontPx: number | undefined;
  private nowProvider: () => number;

  constructor(
    container: HTMLElement,
    store: MemoStore,
    getToolState: () => ToolState,
    options: CircularCanvasOptions = {}
  ) {
    this.container = container;
    this.store = store;
    this.getToolState = getToolState;
    this.interactive = options.interactive ?? true;
    this.textEditorZIndex = options.textEditorZIndex;
    this.textEditorMinWidthPx = options.textEditorMinWidthPx;
    this.fixedBottomTextEditorOnCoarsePointer = options.fixedBottomTextEditorOnCoarsePointer ?? true;
    this.minRenderedTextFontPx = options.minRenderedTextFontPx;
    this.nowProvider = options.nowProvider ?? Date.now;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "circle-canvas";
    this.container.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context is not available");
    this.ctx = ctx;

    this.frame = new FrameGeometry(this.canvas, this.container, this.dpr, {
      contentScaleFactor: options.contentScaleFactor,
      minCanvasSizePx: options.minCanvasSizePx,
    });
    // ウィンドウのリサイズだけでなく、フッターの折り返しやフォント読み込みによる
    // レイアウト変化など、コンテナの実サイズが変わるあらゆるタイミングを動的に捉える
    this.resizeObserver = new ResizeObserver(() => {
      this.frame.resize();
      // レイアウトが変わった後に古いズーム・パン量を引きずると見た目が破綻する
      // ため、コンテナの実サイズが変わった場合はリセットする（画面回転など）。
      // ただしResizeObserver自体は「実際に幅・高さが変わったか」を問わず発火する
      // ——過去めくり画面の開閉でcanvasWrap.hiddenを切り替えると、コンテナが
      // 一度0x0を経由してから元と同じサイズに戻るだけでも発火してしまうため、
      // 前回計測したサイズと比較し、実質的な変化が無ければズーム・パンは
      // 保持する（ユーザー報告：過去めくり画面を開閉するだけでズームが消える）。
      // rectが0x0（canvasWrap.hidden化で一時的に不可視になった瞬間）は「実際の
      // レイアウト情報が無い」状態として扱い、比較対象の更新自体をスキップする
      // ——ここでlastContainerSizeを0x0のまま書き換えてしまうと、再表示された
      // 瞬間に「0から実サイズへ変わった」と誤検知して結局リセットしてしまう
      // （非表示→表示の往復2回のうち、後半の発火だけでリセットが起きてしまい
      // ガードが効かなかった実測不具合）。
      const rect = this.container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const sizeChanged =
          this.lastContainerSize === null ||
          Math.abs(rect.width - this.lastContainerSize.width) > 0.5 ||
          Math.abs(rect.height - this.lastContainerSize.height) > 0.5;
        this.lastContainerSize = { width: rect.width, height: rect.height };
        if (sizeChanged) {
          this.viewZoom = 1;
          this.viewPan = { x: 0, y: 0 };
        }
      }
      this.syncEmptyStatePosition();
      // モバイルでソフトキーボードが開閉するとcontainerの実サイズが変わり
      // ここが発火する。text-editor-overlayを開いたままだと、位置がタップ時点の
      // 古いフレームのまま取り残されてしまうため、開いていれば今のフレームに
      // 合わせて再配置する（ユーザー指摘：タップ位置から離れた所に表示される）。
      this.repositionTextEditor?.();
    });
    this.resizeObserver.observe(this.container);

    if (this.interactive) {
      // キャンバス自身は独自のタッチ操作（描画・消しゴム等）を全て自前で処理する
      // ため、ブラウザ純正のタッチ操作（スクロール等）は不要——それ以外の画面
      // 全体については、style.cssのhtml,bodyにtouch-action: pan-x pan-yを
      // 設定してあり、ページのどこでピンチしてもブラウザ純正のピンチズームには
      // 奪われず、下のonGlobalPointerDown等の自前のピンチズームだけが働く
      // （スクロールは引き続き効く。ユーザー指示：「画面のどこでもズームを
      // 実行可能にしたい」）。
      this.canvas.style.touchAction = "none";
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("pointerup", this.onPointerUp);
      window.addEventListener("pointercancel", this.onPointerUp);
      window.addEventListener("keydown", this.onGlobalKeyDown);
      // ページのどこでタッチしても2本指ならこのキャンバスをピンチズームできる
      // ように、キャンバス要素の外側で発生した指も含めてwindowレベルで監視する。
      window.addEventListener("pointerdown", this.onGlobalPointerDown);
      window.addEventListener("pointermove", this.onGlobalPointerMove);
      window.addEventListener("pointerup", this.onGlobalPointerUp);
      window.addEventListener("pointercancel", this.onGlobalPointerUp);
      window.visualViewport?.addEventListener("resize", this.onVisualViewportChange);
      window.visualViewport?.addEventListener("scroll", this.onVisualViewportChange);
      // 空のキャンバスの案内は対話可能なキャンバスにだけ持たせる——ルーム未接続の
      // プレースホルダー（interactive:false）は無地の白い紙のままにする（ユーザー指示）。
      this.buildEmptyState();
    }
  }

  /** 現在の書き込みクランプ関数。キャンバスの枠形状（正方形・角丸）のclampを
   *  そのまま使う。onPointerDownでpointerdown自体の可否ゲートとしても
   *  使われている。 */
  private inputClamp(): (p: Point) => Point {
    return this.frame.currentShape().clamp;
  }

  /** 空のキャンバスに重ねる案内を組み立てる。canvas要素の兄弟としてcontainerに
   *  入れる（position:absolute、containerに付けた.canvas-hostが基準）——画面固定
   *  (position:fixed)でbody直下に置く.text-editor-overlayと違い、この案内は
   *  出しっぱなしになる要素のため、タブを切り替えて#canvas-panelがhiddenに
   *  なったときに一緒に消えてくれるcontainerの子である方が確実。 */
  private buildEmptyState(): void {
    this.container.classList.add("canvas-host");

    const el = document.createElement("div");
    el.className = "canvas-empty-state fade-visible";
    el.hidden = true;

    const hint = document.createElement("p");
    hint.className = "canvas-empty-hint";
    hint.textContent = pickRandomEmptyStateHint();
    el.appendChild(hint);
    this.emptyStateHintEl = hint;

    this.container.appendChild(el);
    this.emptyStateEl = el;
    this.setEmptyStateVisible = createFadeVisibility(el);
    this.syncEmptyStatePosition();
  }

  /** 案内を「書ける領域の中心のすこし下」に合わせ直す。位置が変わるのはコンテナの
   *  リサイズとフレーム形状の切り替え（どちらもframe.resize()を通る）だけなので、
   *  renderの毎フレームではなくそのタイミングだけで呼ぶ（smuiViewのrepositionStatus
   *  と同じ、毎フレームのレイアウト読み出しを避ける流儀）。 */
  private syncEmptyStatePosition(): void {
    const el = this.emptyStateEl;
    if (!el) return;
    const scale = this.effectiveScale();
    const dy = EMPTY_STATE_OFFSET_Y * scale;
    el.style.left = `${this.canvas.offsetLeft + this.frame.centerPx.x + this.viewPan.x}px`;
    el.style.top = `${this.canvas.offsetTop + this.frame.centerPx.y + this.viewPan.y + dy}px`;
  }

  /** ピンチズームの倍率を加味した、正規化座標→画面px変換の実効スケール。 */
  private effectiveScale(): number {
    return this.frame.scale * this.viewZoom;
  }

  /** 案内を出す条件（メモが1つも無い／テキスト入力中でない）を毎フレーム見直す
   *  （テンプレートは選んだ瞬間に置かれるため、この条件だけで足りる）。
   *  メモの増減はクラウド同期・共有ルームのポーリング・寿命切れなど
   *  通知の無い経路でも起きるため、renderのついでに見るのがいちばん確実——DOMに触るのは
   *  表示・非表示が実際に切り替わった瞬間だけにする。 */
  private syncEmptyState(activeMemoCount: number): void {
    if (!this.emptyStateEl || !this.setEmptyStateVisible) return;
    const show = activeMemoCount === 0 && !this.textEditor;
    if (show === this.emptyStateShown) return;
    this.emptyStateShown = show;
    if (show) {
      this.syncEmptyStatePosition(); // 隠れている間にリサイズされていた場合に備える
      if (this.emptyStateHintEl) {
        // 前回の非表示化がフェードの途中で止められていた場合に備え、
        // 不透明度を確実にリセットしてから文言を決め直す。
        this.emptyStateHintEl.style.transitionDuration = "0ms";
        this.emptyStateHintEl.style.opacity = "1";
        this.typeEmptyStateHint(pickRandomEmptyStateHint());
      }
    } else {
      this.stopEmptyStateHintRotation();
    }
    this.setEmptyStateVisible(show);
  }

  /** 案内文の自動切り替えサイクルのうち「表示している時間」を計るタイマーを
   *  開始する（案内が表示されている間だけ）。打ち込みが終わった直後
   *  （typeEmptyStateHint参照）に呼ぶ。二重に走らせないよう、まず既存のタイマーを
   *  止めてから張り直す。 */
  private startEmptyStateHintRotation(): void {
    this.stopEmptyStateHintRotation();
    this.emptyStateHintHoldTimer = setTimeout(() => this.fadeOutEmptyStateHint(), EMPTY_STATE_HINT_VISIBLE_MS);
  }

  /** 案内文の自動切り替えを止める。案内が消える瞬間、およびdestroy()で呼ぶ。 */
  private stopEmptyStateHintRotation(): void {
    if (this.emptyStateHintHoldTimer !== null) {
      clearTimeout(this.emptyStateHintHoldTimer);
      this.emptyStateHintHoldTimer = null;
    }
    if (this.emptyStateHintFadeTimer !== null) {
      clearTimeout(this.emptyStateHintFadeTimer);
      this.emptyStateHintFadeTimer = null;
    }
    if (this.emptyStateHintTypeTimer !== null) {
      clearInterval(this.emptyStateHintTypeTimer);
      this.emptyStateHintTypeTimer = null;
    }
  }

  /** 案内文をEMPTY_STATE_HINT_FADE_OUT_MSかけてゆっくりフェードアウトさせる
   *  （ユーザー指示）。完了したら差し替えて打ち込みを始める。 */
  private fadeOutEmptyStateHint(): void {
    const el = this.emptyStateHintEl;
    if (!el) return;
    el.style.transitionDuration = `${EMPTY_STATE_HINT_FADE_OUT_MS}ms`;
    el.style.opacity = "0";
    this.emptyStateHintFadeTimer = setTimeout(() => {
      this.emptyStateHintFadeTimer = null;
      this.typeEmptyStateHint(pickRandomEmptyStateHint(el.textContent));
    }, EMPTY_STATE_HINT_FADE_OUT_MS);
  }

  /** 案内文をフェードではなく、タイプライターのように1文字ずつ打ち込んで見せる
   *  （ユーザー指示：フェードインではなく入力されているような見た目にしたい）。
   *  打ち終えたら「表示している時間」のタイマー（startEmptyStateHintRotation）を
   *  開始する。 */
  private typeEmptyStateHint(text: string): void {
    const el = this.emptyStateHintEl;
    if (!el) return;
    el.style.transitionDuration = "0ms";
    el.style.opacity = "1";
    el.textContent = "";
    const chars = Array.from(text); // サロゲートペア・結合文字を1文字単位で崩さない
    let i = 0;
    this.emptyStateHintTypeTimer = setInterval(() => {
      i++;
      el.textContent = chars.slice(0, i).join("");
      if (i >= chars.length) {
        clearInterval(this.emptyStateHintTypeTimer!);
        this.emptyStateHintTypeTimer = null;
        this.startEmptyStateHintRotation();
      }
    }, EMPTY_STATE_HINT_TYPE_MS);
  }

  /** 画面ピクセル座標 → 正規化座標（円の半径・長方形の半辺を1とする、中心が原点）。
   *  クランプ前の生の値——輪郭の外側かどうかの判定（onPointerDown参照）に使う。 */
  private toNormalizedRaw(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.effectiveScale();
    return {
      x: (clientX - rect.left - this.frame.centerPx.x - this.viewPan.x) / scale,
      y: (clientY - rect.top - this.frame.centerPx.y - this.viewPan.y) / scale,
    };
  }

  /** 画面ピクセル座標 → 正規化座標（円の半径・長方形の半辺を1とする、中心が原点）。
   *  今選んでいるフレーム形状の輪郭の外にあれば内側に丸め込む。 */
  private toNormalized(clientX: number, clientY: number): Point {
    return this.inputClamp()(this.toNormalizedRaw(clientX, clientY));
  }

  private scheduleSessionClose(): void {
    if (this.state.idleTimer !== null) window.clearTimeout(this.state.idleTimer);
    this.state.idleTimer = window.setTimeout(() => {
      this.state.activeMemoId = null;
      this.state.idleTimer = null;
    }, WRITING_SESSION_IDLE_MS);
  }

  /**
   * 書き込み中のセッションを強制的に閉じる。道具・色・消えるまでの期間を切り替えた直後に
   * 呼ぶことで、次のストロークが古いメモへの追記ではなく新しいメモとして始まるようにする。
   */
  closeWritingSession(): void {
    if (this.state.idleTimer !== null) window.clearTimeout(this.state.idleTimer);
    this.state.activeMemoId = null;
    this.state.idleTimer = null;
  }

  /** 今のジェスチャーで初めてストアを書き換える直前に呼ぶ（issue #89のundo/
   *  redo）。同じジェスチャー中の2回目以降の呼び出しは何もしない
   *  （undoSnapshotTakenのコメント参照）。 */
  private ensureUndoSnapshot(): void {
    if (this.undoSnapshotTaken) return;
    this.undoSnapshotTaken = true;
    this.store.snapshotForUndo();
  }

  private hitTestMemo(p: Point): Memo | null {
    const threshold = HIT_THRESHOLD_PX / this.effectiveScale();
    for (const memo of this.store.getActive()) {
      if (memo.kind === "stroke") {
        if (pointNearStrokes(p, memo.strokes, threshold)) return memo;
      } else if (
        circleIntersectsBox(p, threshold, {
          x: memo.x,
          y: memo.y,
          width: memo.boxWidth,
          height: memo.boxHeight,
        })
      ) {
        return memo;
      }
    }
    return null;
  }

  private onPointerDown = (ev: PointerEvent): void => {
    ev.preventDefault();
    // ピンチ中、または既に他の指が1本指ジェスチャーを進行させている間は、
    // 2本目以降の指をここでは扱わない——ピンチの検知・開始はキャンバスの
    // 外側も含めてonGlobalPointerDownがwindowレベルで一括して行う。
    if (this.state.mode === "pinching" || this.activePointerId !== null) return;

    // 見た目の枠（円/楕円/長方形）の外側は、<canvas>要素自体はその外側まで矩形で
    // 広がっているため座標としては拾えてしまう——クランプ前の生の座標で内外を
    // 判定し、外側ならジェスチャーを始めずに無視する（issue: 円の外にpointerdown
    // すると、toNormalizedのクランプで円周上の点として扱われ描画されてしまう）。
    const raw = this.toNormalizedRaw(ev.clientX, ev.clientY);
    if (!isInsideClamp(raw, this.inputClamp())) return;

    // 指がキャンバス外に多少はみ出してもmove/upを確実に拾えるようにする
    // （pointerdown/moveはcanvas要素、pointerup/cancelはwindowという非対称な
    // 登録なので、captureで一本化しておく）。
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      // ブラウザ差異等でcaptureに失敗しても致命的ではないため無視する。
    }
    this.activePointerId = ev.pointerId;

    if (this.textEditor) return; // テキスト入力中は他の操作を受け付けない（blurで確定してから）
    const p = raw;

    const tool = this.getToolState().tool;
    // 新しいジェスチャーの開始（issue #89のundo/redo、undoSnapshotTaken参照）。
    this.undoSnapshotTaken = false;

    if (tool === "eraser") {
      this.state.mode = "erasing";
      this.state.lastPoint = p;
      // eraserHoverPointも合わせて更新しておく（下のonPointerMoveの"erasing"
      // 分岐と同じ理由——指を離した瞬間にrender()がこちらを参照し直すため）。
      this.eraserHoverPoint = p;
      this.ensureUndoSnapshot();
      this.store.eraseAt(p, this.getToolState().eraserRadius / this.effectiveScale());
      return;
    }

    const hitMemo = this.hitTestMemo(p);

    if (tool === "move") {
      // 移動道具：既存のメモに触れた場合だけドラッグを開始する。何もない場所をタップしても
      // 新規作成はしない（道具の役割を「動かすだけ」に絞るため）
      if (hitMemo) {
        this.state.mode = "moving";
        this.state.movingMemoId = hitMemo.id;
        this.state.lastPoint = p;
      }
      return;
    }

    if (tool === "text") {
      // 既存のテキストメモに触れた場合は編集を開く。
      if (hitMemo && hitMemo.kind === "text") {
        this.openTextEditor({ x: hitMemo.x, y: hitMemo.y }, hitMemo);
      } else {
        this.openTextEditor(p);
      }
      return;
    }

    // ペン・マーカー：既存メモの上に重なっても常に新規描画のみを行う。
    this.state.mode = "drawing";
    this.ensureUndoSnapshot();
    if (this.state.activeMemoId) {
      this.store.startStroke(this.state.activeMemoId, p);
    } else {
      const { color, lineWidth } = this.getToolState();
      const memo = this.store.createMemo(p, { tool: tool as "pen" | "marker", color, lineWidth }, this.nowProvider());
      this.state.activeMemoId = memo.id;
    }
    if (this.state.idleTimer !== null) window.clearTimeout(this.state.idleTimer);
  };

  /** ページのどこにタッチしても（キャンバス要素の外側でも）2本目の指を検知
   *  できるよう、windowレベルですべてのpointerdownを監視する。今表示中の
   *  インタラクティブなキャンバスだけが反応する——非表示のタブ・
   *  interactive:falseのプレースホルダーは無視する（ユーザー指示：
   *  「どこを2本指でしてもキャンバスのみをズームしたい」）。
   *
   *  2本目の指が乗った瞬間にev.preventDefault()する——style.cssのtouch-action
   *  だけでは、iOS Safariでヘッダー/ツールバー（position:fixedの帯）の上だと
   *  純正のピンチズームが発動してしまう不具合があった（ユーザー報告）。
   *  canvas自身の単指描画（onPointerDown）は最初からpreventDefault()で
   *  純正ジェスチャーを止めており実際に機能しているため、同じ考え方を
   *  2本指検知にも適用する——1本目だけの間は呼ばない（通常のタップ・
   *  ボタン操作を妨げないため）。
   *
   *  ピンチズーム自体（beginPinch）は「選択」道具（move）を選んでいる時だけ
   *  始める——ペン・マーカー・消しゴム・なぞる・テキストの間に指が2本乗っても
   *  （誤って触れた・手のひらが触れた等）、進行中の描画等を中断してズームに
   *  切り替えてしまうのはユーザーにとって意図しない挙動のため（ユーザー指示）。
   *  ただしpreventDefault自体は道具に関わらず呼ぶ——ここで止めないと、
   *  ズームは始めなくてもSafari等の純正ピンチズームがページ全体に効いてしまう。
   *
   *  複数指タップ（issue #90）の判定用の記録も、道具に関わらず常にここで行う
   *  ——undo/redoはどの道具を選んでいても使いたい操作のため。今回の
   *  マルチタッチの塊の最初の指（pinchPointersが0→1になった瞬間）で判定を
   *  リセットし、以後この塊に加わった指の最大本数（tapGesturePeakCount）を
   *  更新し続ける。有効性（tapGestureValid）の判定はonGlobalPointerMoveで、
   *  実際にundo/redoを呼ぶ判定はonGlobalPointerUpで行う。 */
  private onGlobalPointerDown = (ev: PointerEvent): void => {
    if (!this.interactive) return;
    if (this.canvas.offsetParent === null) return; // 今表示中のタブのキャンバスでなければ無視

    const pos = { x: ev.clientX, y: ev.clientY };
    if (this.pinchPointers.size === 0) {
      this.tapGesturePeakCount = 0;
      this.tapGestureValid = true;
      this.tapGestureStartAt = Date.now();
    }
    this.pinchPointers.set(ev.pointerId, { pos, downPos: pos });
    this.tapGesturePeakCount = Math.max(this.tapGesturePeakCount, this.pinchPointers.size);

    if (this.pinchPointers.size === 2) {
      ev.preventDefault();
      if (this.getToolState().tool === "move") {
        this.beginPinch();
      }
    }
    // 3本目以降はそのまま追跡だけしておく（既存のピンチの起点は変えない）。
  };

  /** ピンチ対象として追跡中の指が動くたびに呼ぶ（windowレベル）。2本以上の指を
   *  追跡している間は道具に関わらず常にev.preventDefault()し続ける——2本目の
   *  pointerdownだけを止めても、その後の移動でSafariの純正ジェスチャーが
   *  再度乗っ取ってくることがあるため（onGlobalPointerDownのコメント参照）。
   *  以前は選択ツールでのピンチ中(mode==="pinching")に限っていたが、それ以外の
   *  道具では2本目以降の指の動きをSafari純正のジェスチャー（ダブルタップ/
   *  マルチタッチでのズーム等）が横取りしてしまい、指の位置がブレて複数指
   *  タップ（issue #90）の判定まで狂う不具合になっていた（ユーザー報告・
   *  実機Safariで再現確認）。触れている指がTAP_MAX_MOVEMENT_PXを超えて
   *  動いたら、この一連のマルチタッチはもう複数指タップとはみなさない
   *  （ドラッグ・ピンチとして進行する）。 */
  private onGlobalPointerMove = (ev: PointerEvent): void => {
    const tracked = this.pinchPointers.get(ev.pointerId);
    if (!tracked) return;
    tracked.pos = { x: ev.clientX, y: ev.clientY };
    if (pointerDistance(tracked.pos, tracked.downPos) > TAP_MAX_MOVEMENT_PX) {
      this.tapGestureValid = false;
    }
    if (this.pinchPointers.size >= 2) {
      ev.preventDefault();
    }
    if (this.state.mode === "pinching") {
      this.updatePinch();
    }
  };

  /** ピンチ対象として追跡中の指が離れるたびに呼ぶ（windowレベル）。追跡していた
   *  全ての指が離れた（このマルチタッチの塊が終わった）時点で、複数指タップの
   *  条件（本数・移動量・所要時間）を満たしていればundo/redoを呼ぶ（issue #90）。
   *  「選択」道具を選んでいる間だけ判定する——ペン・消しゴム等では1本目の指が
   *  触れた瞬間に即座にストアを書き換える（ensureUndoSnapshot）ため、タップと
   *  確定する前の暫定的な書き換えがundo/redoの履歴と絡み合ってしまい、特に
   *  3本指タップ（redo）はその暫定書き換え自体がredo履歴を消してしまって
   *  正しく機能しないことがあった（実機で再現確認）。選択道具は1本目の指
   *  だけでは何も書き換えない（実際に動かして初めてtranslateMemoが呼ばれる）
   *  ため、この問題が起きない。ペン等でも取り消したい場合は、道具バーの
   *  「戻る」ボタン（toolbar.ts）を使う。 */
  private onGlobalPointerUp = (ev: PointerEvent): void => {
    if (!this.pinchPointers.delete(ev.pointerId)) return;
    // Safariのダブルタップズームは指の移動量ではなく、連続する2回のタップの
    // 間隔（touchend/pointerupのタイミング）で判定される——onGlobalPointerMove
    // 側のpreventDefault()（指が動く間だけ効く）では止められないため、こちらも
    // このマルチタッチの塊に2本以上の指が関わっていた間はpreventDefault()する
    // （複数指タップ自体がSafari純正のズームと誤認されないようにするため。
    // ユーザー報告・実機Safariで再現確認：3本指タップを2回繰り返すと時々
    // ズームしてしまっていた）。
    if (this.tapGesturePeakCount >= 2) ev.preventDefault();
    if (this.state.mode === "pinching" && this.pinchPointers.size < 2) {
      // 1本の指を離しただけでは描画を再開しない——残り1本になったら
      // いったんidleに戻し、新しいpointerdownから仕切り直す。
      this.state.mode = "idle";
      this.pinch = null;
    }
    if (this.pinchPointers.size > 0) return; // まだ他の指が残っている
    if (this.getToolState().tool !== "move") return;

    const withinDuration = Date.now() - this.tapGestureStartAt <= TAP_MAX_DURATION_MS;
    if (!this.tapGestureValid || !withinDuration || this.tapGesturePeakCount < 2) return;

    if (this.tapGesturePeakCount === 2) {
      this.store.undo();
    } else {
      this.store.redo(); // 3本以上はredo扱い（実機での余分な指の巻き込みに寛容にする）
    }
    // undo()と同じ理由（そちらのコメント参照）で、書き込みセッションを打ち切る。
    this.closeWritingSession();
  };

  /** 2本目の指が乗った瞬間に呼ぶ。進行中の1本指ジェスチャー（描画・消しゴム・
   *  なぞる・移動）があれば打ち切ってからピンチの起点を記録する。 */
  private beginPinch(): void {
    if (this.state.mode !== "idle" && this.state.mode !== "pinching") {
      this.endSinglePointerGesture();
    }
    this.activePointerId = null; // 1本指ジェスチャーはピンチに譲る
    const [a, b] = [...this.pinchPointers.values()].map((p) => p.pos);
    this.state.mode = "pinching";
    this.pinch = {
      startDist: pointerDistance(a, b),
      startZoom: this.viewZoom,
      startMid: pointerMidpoint(a, b),
      startPan: { ...this.viewPan },
    };
  }

  /** ピンチ中、いずれかの指が動くたびに呼ぶ。指間距離の変化比でズーム、
   *  中点の移動量でパンを更新する。 */
  private updatePinch(): void {
    if (!this.pinch || this.pinchPointers.size < 2) return;
    const [a, b] = [...this.pinchPointers.values()].map((p) => p.pos);
    const dist = pointerDistance(a, b);
    const mid = pointerMidpoint(a, b);
    this.viewZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.pinch.startZoom * (dist / this.pinch.startDist)));
    const pan = {
      x: this.pinch.startPan.x + (mid.x - this.pinch.startMid.x),
      y: this.pinch.startPan.y + (mid.y - this.pinch.startMid.y),
    };
    this.viewPan = this.viewZoom <= MIN_ZOOM ? { x: 0, y: 0 } : this.clampPan(pan);
    this.syncEmptyStatePosition();
  }

  /** フレームが完全に画面外へ出てしまわないよう、パン量をズーム倍率に応じた範囲に
   *  収める（ズームしていないときはパン自体を許可しない）。フレーム形状の水平/
   *  垂直到達距離（shape.horizontalReach、垂直は常に1正規化単位）でパン量を
   *  正規化してからクランプする——円形クランプのまま（frame.scaleのみ基準）だと、
   *  oval（横長楕円）やglasses（共有キャンバス、横長矩形）のように縦横の到達距離が
   *  異なる形状で、縦基準の狭い円の範囲にパンが制限されてしまう。round/square
   *  （縦横の到達距離が等しい）では結果的に同じ挙動になる。
   *
   *  クランプを完全に撤廃したところ、ズーム＋パンでフレームの縁（曲線の境界）が
   *  画面外まで遠く離れてしまい、円の内側の平らな部分しか見えず正方形の紙にしか
   *  見えなくなる不具合が発生したため復活させた（ユーザー報告・実機で再現確認）。 */
  private clampPan(pan: Point): Point {
    const shape = this.frame.currentShape();
    const maxOffsetX = this.frame.scale * shape.horizontalReach * (this.viewZoom - 1);
    const maxOffsetY = this.frame.scale * (this.viewZoom - 1);
    if (maxOffsetX <= 0 || maxOffsetY <= 0) return { x: 0, y: 0 };
    const nx = pan.x / maxOffsetX;
    const ny = pan.y / maxOffsetY;
    const mag = Math.hypot(nx, ny);
    if (mag <= 1) return pan;
    const k = 1 / mag;
    return { x: pan.x * k, y: pan.y * k };
  }

  /** 1本指ジェスチャー（描画・消しゴム・移動）の後始末。onPointerUpと
   *  「2本目の指が乗って途中でピンチに切り替わった」場合の両方から呼ぶ。 */
  private endSinglePointerGesture(): void {
    if (this.state.mode === "drawing") {
      // ドラッグせずに離した一瞬のクリックは、線としては何も描けていない
      // （renderMemoAtがstroke.length<2のメモを描画対象から除外する）ため、
      // ストア側にも「見えないメモ」を残さない（詳しくはdiscardTrailingSinglePointStroke参照）。
      if (this.state.activeMemoId && this.store.discardTrailingSinglePointStroke(this.state.activeMemoId)) {
        this.state.activeMemoId = null;
      }
      this.scheduleSessionClose();
    }
    this.state.mode = "idle";
    this.state.movingMemoId = null;
    this.state.lastPoint = null;
  }

  /**
   * タップした位置にテキスト入力用の<textarea>を重ねて表示する。円のクリップの外に
   * 出しても構わないよう画面固定(position:fixed)で配置し、blurした時点で内容を
   * 確定する。Enterは確定（≒blur）、Shift+Enterは改行（ユーザー指示）。
   * editingMemoを渡すと既存のテキストメモの編集になる：元の位置・見た目（フォントサイズ・色）を
   * そのまま使い、内容だけ書き換えて更新する。空にして確定した場合はメモごと削除する。
   * Escapeで閉じた場合はキャンセル（新規なら何も作らず、編集なら元の内容のまま）。
   * initialTextは、何も選択していない状態でキーボード入力を始めたときに、その最初の
   * 1文字を最初から入った状態で開くために使う（onGlobalKeyDown参照。editingMemoと
   * 同時には使わない）。
   * focus()は必ず、呼び出し元のポインタ・キー入力イベントと同じ同期的な呼び出し
   * スタックの中で行う（後述のfocusEl、rAFやsetTimeout等を挟まない）。理由は2つ：
   * ①モバイル（特にiOS Safari系）はユーザー操作のイベントハンドラ内で同期的に
   * focus()しないとソフトウェアキーボードが開かない制約があり、1フレーム遅らせると
   * タップ1回では入力を始められず、2回目のタップでtextarea自体に触れて初めて
   * 開くようになってしまっていた（ユーザー報告・実機で再現確認）。②キーボードから
   * 始めた場合（onGlobalKeyDown）は、フォーカスが遅れるとその間に発生した後続の
   * キー入力（特に日本語IME変換中の2文字目以降）がこのtextareaではなく元の
   * フォーカス先（たいていdocument.body）に向かってしまい、変換途中の文章が
   * 複数のマスに分裂して書き込まれてしまう不具合があった（別途ユーザー報告・
   * 実機で再現確認）。
   */
  private openTextEditor(anchor: Point, editingMemo: TextMemo | null = null, initialText?: string): void {
    if (this.textEditor) return;
    // 新しいジェスチャー（1回のテキスト編集セッション）の開始（issue #89の
    // undo/redo、undoSnapshotTaken参照）。Escapeで取り消した場合はストアを
    // 一切書き換えないため、スナップショットも積まれない。
    this.undoSnapshotTaken = false;
    const { color: toolColor, fontSize: toolFontSize } = this.getToolState();
    const color = editingMemo?.color ?? toolColor;
    const fontSize = editingMemo?.fontSize ?? toolFontSize;
    const align = editingMemo?.align ?? "center";
    const lineHeight = editingMemo?.lineHeight ?? LINE_HEIGHT_MULTIPLIER;
    const scaleAtOpen = this.effectiveScale();
    const fontPx = fontPxForRender(fontSize, scaleAtOpen);

    const el = document.createElement("textarea");
    // モバイル（issue #87：キーボード直上に固定表示する分岐）では、紙の上に
    // 直接書き込んでいるのではなくキャンバスから切り離されたUI部品であることが
    // 見た目からも伝わるよう、ツールバーの.control-blockと同じカード風の
    // スタイルに切り替える（--fixed-bottom、ユーザー指示）。
    const useFixedBottomEditor = isCoarsePointerDevice() && this.fixedBottomTextEditorOnCoarsePointer;
    el.className = useFixedBottomEditor
      ? "text-editor-overlay text-editor-overlay--fixed-bottom"
      : "text-editor-overlay";
    el.rows = 1;
    el.placeholder = "書き込む...";
    el.value = editingMemo?.text ?? initialText ?? "";
    if (this.textEditorZIndex !== undefined) el.style.zIndex = String(this.textEditorZIndex);
    el.style.color = color;
    el.style.fontFamily = TEXT_FONT_FAMILY;
    // iOS Safari系は、フォーカスした入力欄のfont-sizeが16px未満だと「読みやすく
    // するため」勝手にページ全体をズームインする——これがタップ直後に画面が
    // アップになり、かつそのズームでvisualViewportが動いた拍子にオーバーレイの
    // 位置計算まで狂う（タップ位置と無関係な場所に出る）原因になっていた
    // （ユーザー報告・実機で再現確認）。モバイルでは実際のfontPx（基準文字サイズ
    // ×実効スケール）が16pxを大きく下回るため常に発火していた。表示上の
    // font-sizeだけ16px以上に底上げしてズームそのものを起こさせないようにする
    // ——確定後にメモとして保存される文字サイズ・折り返し幅はcanvas側の計測
    // （fontSize・measureTextBoxWidthPx、共にこのDOM要素のstyleとは独立）で
    // 決まるため、ここでの底上げは編集中の見た目だけに影響し、確定後の見た目には
    // 影響しない。
    const displayFontPx = Math.max(fontPx, 16);
    el.style.fontSize = `${displayFontPx}px`;
    el.style.lineHeight = `${lineHeight}`;
    el.style.textAlign = align;
    // resizeToContent内の幅測定(measureTextBoxWidthPx)にfontSizeをそのまま渡すと、
    // 上の底上げが効くケース（scaleAtOpenがREFERENCE_RADIUSより小さい典型的な
    // モバイル画面）で、実際にdisplayFontPxで描画される文字より狭い幅で計算されて
    // しまい、1行に収まるはずの文章が編集中だけtextarea内で折り返される／はみ出して
    // 見える不具合になる（PRレビュー指摘）。measureTextBoxWidthPxは基準円スケールの
    // 値を受け取りresizeToContent側で実際のscaleを掛けて画面px化する仕組みのため、
    // displayFontPx（画面px）をその逆変換で基準円スケール相当に戻した値を使うことで、
    // 編集中の幅計算と実際の描画フォントサイズを一致させる。
    const widthMeasureFontSize = Math.max(fontSize, (displayFontPx * REFERENCE_RADIUS) / scaleAtOpen);
    document.body.appendChild(el);
    this.textEditor = el;

    // モバイルでtextareaにフォーカスすると、ブラウザが「フォーカスした要素が画面内に
    // 収まるように」ページ全体を自動でスクロールすることがある。このtextareaは
    // position:fixedで自前で画面上の位置を計算しているため、ブラウザのその自動
    // スクロールは不要などころか、resizeToContentがcanvas要素のgetBoundingClientRect()
    // を毎回計算し直す実装のため、ページがスクロールした分だけ位置計算も引きずられて
    // 動いてしまい、タップした位置と無関係な場所に表示される・スクロールにつれて
    // 動いて見えるという不具合の原因になっていた（ユーザー報告・実機で再現確認）。
    // 編集中はhtml/bodyのスクロールを封じてしまい、ブラウザにこの自動スクロールを
    // そもそも起こさせないようにする（commit/キャンセル時に元の値へ戻す）。
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    // overflow:hiddenとel.focus({preventScroll:true})だけでは、iOS Safariが
    // ソフトキーボード表示に合わせて行う「キーボード回避パン」を防げず、わずかに
    // 画面がスクロールしたままになることがある（ユーザー報告・再現）。この回避パンは
    // scrollTop自体を動かすものではなく、実際に見えている範囲（visual viewport）を
    // ページ内で上下させる別物のため、window.scrollTo(0,0)による打ち消しでは効かない。
    // bodyを丸ごとposition:fixedにして「そもそもスクロール可能な要素が存在しない」
    // 状態にすると、この回避パン自体をブラウザに起こさせずに済む（body-scroll-lock
    // 等でも使われる標準的な手法）。html/body自体は常にoverflow:hidden・高さ100%で
    // スクロール位置が0のままの設計（style.css参照）のため、top:0固定で戻す位置の
    // 計算は不要。
    const prevBodyPosition = document.body.style.position;
    const prevBodyWidth = document.body.style.width;
    const prevBodyTop = document.body.style.top;
    const prevBodyLeft = document.body.style.left;
    document.body.style.position = "fixed";
    document.body.style.width = "100%";
    // top/leftを明示しないと"auto"のまま＝ブラウザが「positionをstaticのままに
    // していたら本来あったはずの位置」を計算し続け、その計算に何らかの形で
    // スクロール量が紛れ込んで結局スクロール分だけ動いて見える現象を実機で確認した
    // （bodyのgetBoundingClientRect().topがスクロール量とちょうど一致して動いていた）。
    // top:0/left:0を明示することで、この「auto」計算を経由させず常に画面左上へ
    // 固定する。
    document.body.style.top = "0";
    document.body.style.left = "0";
    this.restoreBodyScroll = () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.position = prevBodyPosition;
      document.body.style.width = prevBodyWidth;
      document.body.style.top = prevBodyTop;
      document.body.style.left = prevBodyLeft;
      this.restoreBodyScroll = null;
    };

    // 内容の実際の幅・高さに合わせてtextareaのサイズと位置を更新する（可変幅——
    // ユーザー指示：短い一言でも余白だらけの箱にならないよう、逆に長めの文でも
    // すぐ折り返さないよう、打った内容に応じて幅を変える）。アンカー点
    // (screenX, screenY)は毎回、その時点のcanvasRect/frame.centerPx/viewPan/
    // scaleから計算し直す——1回だけ計算してクロージャに固定していると、
    // モバイルでキーボードが開いてcontainerのサイズが変わりframeが動いた後も
    // 古い位置のまま取り残されてしまう（ユーザー指摘：タップ位置から離れた所に
    // 表示される）。呼び出し元（入力のたびとResizeObserver）の両方から同じ
    // 関数を呼び直すことで、常に今のフレームに対して正しい位置に揃える。
    //
    // visualViewport.offsetLeft/offsetTopの補正について：モバイルでキーボードを
    // 開く際、ブラウザは「フォーカスした要素をキーボードの上に収める」ため
    // ビジュアルビューポート（実際に画面に見えている範囲）だけをページ内で
    // 上下にパンすることがある（レイアウトビューポート自体は動かない）。
    // getBoundingClientRect()はレイアウトビューポート基準の値を返すのに対し、
    // position:fixedもレイアウトビューポート基準で配置されるので一見食い違いは
    // 無さそうだが、実際にはこのパンの分だけ画面上の見た目とズレる
    // （タップ位置が下の方＝パン量が大きいほど、入力欄が上へ大きく飛び出して
    // 見える。ユーザー報告・実機で再現確認：下半分をタップすると画面外まで
    // 飛ぶが上半分は少しのズレで済む＝パン量の違いと一致）。
    // window.visualViewport.offsetLeft/offsetTopはこのパン量そのものなので、
    // 加算して補正する（MDN/web.devで案内されている標準的な対処）。
    const resizeToContent = () => {
      const canvasRect = this.canvas.getBoundingClientRect();
      const scale = this.effectiveScale();
      const vv = window.visualViewport;
      const viewportOffsetX = vv?.offsetLeft ?? 0;
      const viewportOffsetY = vv?.offsetTop ?? 0;
      const toScreenPx = (referencePx: number) => (referencePx / REFERENCE_RADIUS) * scale;
      const screenX = canvasRect.left + this.frame.centerPx.x + this.viewPan.x + anchor.x * scale + viewportOffsetX;
      const screenY = canvasRect.top + this.frame.centerPx.y + this.viewPan.y + anchor.y * scale + viewportOffsetY;

      // 文字が空の間はプレースホルダー（「書き込む...」）が見えている。el.valueの
      // ままだと空文字列の幅（≒0）で箱が測られてしまい、プレースホルダーが
      // 箱の中で折り返されてしまう（ユーザー報告）ため、空の間はプレースホルダー
      // 自体の幅で測る。
      const boxWidthPx = Math.max(
        toScreenPx(measureTextBoxWidthPx(this.ctx, el.value || el.placeholder, widthMeasureFontSize)),
        this.textEditorMinWidthPx ?? 0
      );
      el.style.width = `${boxWidthPx}px`;
      el.style.height = "auto";
      const h = el.scrollHeight;
      el.style.height = `${h}px`;

      // ソフトキーボードが開くと、実際に見えている範囲（visual viewport）が
      // 画面下側から縮む。上記のscreenX/screenYはタップ位置をそのまま画面座標に
      // 変換しただけなので、画面下部をタップした直後にキーボードが開くと、
      // その縮んだ「見えている範囲」の外＝キーボードの裏に配置されてしまう
      // ことがある（ユーザー報告：画面下部でテキストを追加しようとすると
      // キーボードによりさらに下へ飛んでいく）。最終的な位置を、実際に見えて
      // いる範囲（visualViewportの現在のoffsetLeft/Top〜+width/height、
      // 取得できない環境ではwindow.innerWidth/Heightにフォールバック）の中に
      // 収まるようクランプする——入力欄自体がその範囲より大きい極端なケースは
      // 見えている範囲の左上に揃えるだけにする。
      const margin = 8;
      const visibleWidth = vv?.width ?? window.innerWidth;
      const visibleHeight = vv?.height ?? window.innerHeight;

      const minLeft = viewportOffsetX + margin;
      const maxLeft = viewportOffsetX + visibleWidth - boxWidthPx - margin;
      const minTop = viewportOffsetY + margin;
      const maxTop = viewportOffsetY + visibleHeight - h - margin;

      let left: number;
      let top: number;
      if (useFixedBottomEditor) {
        // モバイル（ソフトキーボードが出るデバイス）では、タップ位置の上下パンに
        // 追従させるのではなく、常に画面（visualViewport）下部・キーボード直上の
        // 中央に固定表示する（issue #87：iOS標準のキーボード回避パンにタップ位置
        // 追従の位置計算が引きずられ、意図しない場所に飛んで見える不具合の対策）。
        // タップ位置(anchor)自体は、確定後のメモの挿入位置としてのみ使う
        // （commit内のsafeAnchor参照）。
        const centeredLeft = viewportOffsetX + (visibleWidth - boxWidthPx) / 2;
        left = maxLeft >= minLeft ? Math.min(Math.max(centeredLeft, minLeft), maxLeft) : minLeft;
        top = maxTop >= minTop ? maxTop : minTop;
      } else {
        left = maxLeft >= minLeft ? Math.min(Math.max(screenX - boxWidthPx / 2, minLeft), maxLeft) : minLeft;
        top = maxTop >= minTop ? Math.min(Math.max(screenY - h / 2, minTop), maxTop) : minTop;
      }

      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    resizeToContent();
    el.addEventListener("input", resizeToContent);
    this.repositionTextEditor = resizeToContent;
    // 開いた時点でまだ読み込み中のWebフォント（Klee One/Noto Sans JP）があると、
    // 幅の計測（widthMeasureFontSize、上のmeasureTextBoxWidthPx呼び出し）が
    // フォールバックフォントの狭い字幅で行われてしまい、後から本来のフォントに
    // 差し替わった拍子にプレースホルダー等がその幅に収まらず折り返される
    // （ユーザー報告）。フォント読み込み完了を待って、開いていればもう一度
    // 測り直す——読み込み済みなら即座に解決する。
    void document.fonts.ready.then(() => {
      if (this.textEditor === el) resizeToContent();
    });

    // 呼び出し元のイベントハンドラと同じ同期的な呼び出しスタックの中でfocusする
    // （クラス冒頭のJSDoc参照）。preventScroll: trueだけでは、iOS Safariが
    // 「フォーカスした要素をキーボードの上に収める」ため行うページ送り自体は防げず
    // （overflow:hidden・bodyのposition:fixed固定でも防げないネイティブ側の挙動、
    // 実機で計測して確認）、タップした位置が画面下寄りだとこの送りが起きて
    // しまう。フォーカスする一瞬だけ、キーボードの高さによらず絶対に隠れない
    // 画面左上へ避難させておき、フォーカス直後に本来の位置へ戻すことで、
    // 「フォーカスした要素がこれから隠れそうな位置にある」という送りの発生条件
    // 自体を避ける（実機再現確認）。
    const targetLeft = el.style.left;
    const targetTop = el.style.top;
    const vvSafe = window.visualViewport;
    el.style.left = `${(vvSafe?.offsetLeft ?? 0) + 8}px`;
    el.style.top = `${(vvSafe?.offsetTop ?? 0) + 8}px`;
    el.focus({ preventScroll: true });
    // 本来の位置へ戻すのを同じ同期処理の中で即座に行うと、ブラウザがまだ
    // 「安全な位置にフォーカスした」と判定しきる前に動かしてしまうらしく、
    // キャンバス下寄りをタップした時だけ小さな送り（1cm程度）が残っていた
    // （ユーザー報告・実機再現確認）。1フレーム分だけ待ってから戻すことで、
    // フォーカス直後のブラウザ側の判定が安全な位置のまま確定するようにする。
    requestAnimationFrame(() => {
      if (this.textEditor !== el) return;
      el.style.left = targetLeft;
      el.style.top = targetTop;
    });
    el.setSelectionRange(el.value.length, el.value.length); // 編集時・初期文字入り時はカーソルを末尾に

    // 日本語IMEの変換候補確定は、キー入力としてはEnterだが、テキスト全体の確定
    // ではない——kev.isComposingで判定するのが基本だが、変換確定のEnterで
    // ブラウザによってはisComposingが既にfalseに戻っている場合がある
    // （実機で再現確認：かな確定のEnterが「テキスト全体を確定するEnter」と
    // 区別できず、文章の途中でボックスが閉じてしまい、続きが新しいマスに分裂して
    // しまっていた）。compositionstart/endを自前で追跡し、「compositionendの
    // 直後（数十ms以内）のEnter」も変換確定の一部とみなして無視することで、
    // isComposingの値だけに頼るより確実に区別する。
    let composing = false;
    let lastCompositionEndAt = 0;
    const COMPOSITION_GRACE_MS = 50;
    el.addEventListener("compositionstart", () => {
      composing = true;
    });
    el.addEventListener("compositionend", () => {
      composing = false;
      lastCompositionEndAt = performance.now();
    });

    let cancelled = false;
    const commit = () => {
      if (this.textEditor !== el) return; // すでに片付け済みなら何もしない
      this.textEditor = null;
      this.repositionTextEditor = null;
      this.restoreBodyScroll?.();
      const value = el.value.trim();
      el.remove();
      if (cancelled) return; // Escapeでの取り消し：新規作成なら何もせず、編集なら元の内容のまま

      if (editingMemo) {
        if (!value) {
          this.ensureUndoSnapshot();
          this.store.deleteMemo(editingMemo.id);
          return;
        }
        const boxWidthPx = measureTextBoxWidthPx(this.ctx, value, fontSize);
        const lines = wrapTextAtReferenceScale(this.ctx, value, fontSize, boxWidthPx);
        const { width, height } = normalizedBoxSize(fontSize, lines.length, boxWidthPx, lineHeight);
        this.ensureUndoSnapshot();
        this.store.updateTextMemo(editingMemo.id, value, lines, width, height);
        return;
      }

      if (!value) return;
      const boxWidthPx = measureTextBoxWidthPx(this.ctx, value, fontSize);
      const lines = wrapTextAtReferenceScale(this.ctx, value, fontSize, boxWidthPx);
      const { width, height } = normalizedBoxSize(fontSize, lines.length, boxWidthPx);
      // タップした場所をそのまま箱の中心にすると、境界に近い場所をタップした
      // 場合に箱の端が枠の外へはみ出して配置されてしまう（ユーザー指摘）。
      // 実際の文面から箱サイズが決まったこの時点で、箱全体が枠に収まる位置へ
      // 寄せてから確定する。
      const safeAnchor = clampBoxCenter(anchor, width / 2, height / 2, this.inputClamp());
      this.ensureUndoSnapshot();
      this.store.createTextMemo(
        safeAnchor,
        value,
        lines,
        fontSize,
        width,
        height,
        { color },
        this.nowProvider()
      );
    };
    el.addEventListener("blur", commit);
    el.addEventListener("keydown", (kev) => {
      // 日本語IMEで変換候補を選んでいる最中のEscapeは「変換候補を閉じる」ためのキー入力であり、
      // 入力全体の取り消しではない。isComposingを見ずに反応すると、変換候補を1つ閉じたいだけ
      // なのに入力していた文字ごと消えてしまうバグになるため、IME変換中は無視する。
      if (kev.key === "Escape" && !kev.isComposing && !composing) {
        cancelled = true;
        el.blur();
        return;
      }
      // Enterは確定、Shift+Enterは改行（ユーザー指示）。IME変換中・変換確定
      // 直後のEnterはテキスト全体の確定ではないため無視する（上記コメント参照）。
      const justFinishedComposing = performance.now() - lastCompositionEndAt < COMPOSITION_GRACE_MS;
      if (kev.key === "Enter" && !kev.isComposing && !composing && kev.keyCode !== 229 && !justFinishedComposing) {
        if (!kev.shiftKey) {
          kev.preventDefault();
          el.blur(); // blurのcommitハンドラで確定させる
        }
        // Shift+EnterはpreventDefaultしない＝<textarea>既定の改行挿入に任せる
      }
    });
  }

  /** 編集中のテキストがあれば確定する（画面切り替え・道具切り替え時に呼ぶ）。 */
  finishTextEditingIfOpen(): void {
    this.textEditor?.blur();
  }

  /** 道具バーの「戻る」ボタン（issue #90）用。モバイルの2本指タップと違い
   *  道具を問わず使える——ペン等の道具で1本目の指が触れた瞬間の暫定書き換えと
   *  絡み合う問題が無いため（onGlobalPointerUpのコメント参照）。
   *  undoはstore.memosをまるごと差し替えるため、直前まで書き込み継続中だった
   *  メモ（activeMemoId）がstore側から消えている・別内容に置き換わっている
   *  ことがある。closeWritingSessionを呼ばずに残すと、WRITING_SESSION_IDLE_MS
   *  以内に描き始めたとき「継続」のつもりで消えたactiveMemoIdへstartStrokeし
   *  失敗し、何も描かれなくなる不具合があったため、undo直後は必ず書き込み
   *  セッションを打ち切り、次のストロークを新規メモとして始めさせる。 */
  undo(): void {
    this.store.undo();
    this.closeWritingSession();
  }

  private onPointerMove = (ev: PointerEvent): void => {
    // activePointerIdがnullの間（マウスホバー等、まだ何もつかんでいない）は無視せず
    // 通常通り処理する——1本指ジェスチャー中に限り、それ以外の指の動きを無視する
    // （ピンチ中はbeginPinch()がactivePointerIdをnullに戻すため、ここには来ない）。
    if (this.activePointerId !== null && ev.pointerId !== this.activePointerId) return;

    // 円フレームの左右の余白など、<canvas>要素としては範囲内でも実際の輪郭の
    // 外側にいるかどうかをrender()のカーソル決定用に更新する（onPointerDownの
    // 「見た目の枠の外側は無視する」判定と同じisInsideClampを使う）。
    this.pointerInsideFrame = isInsideClamp(this.toNormalizedRaw(ev.clientX, ev.clientY), this.inputClamp());

    if (this.state.mode === "idle") {
      this.updateHoverInfo(ev);
      // 消しゴムのプレビュー円（eraserHoverPoint）は、main.tsの共通rAFループ
      // （60fps、他の描画とまとめて呼ばれる）の次の巡目まで待つと、OS純正の
      // マウスカーソル（即座にコンポジタが描く）に対して最大1フレームぶん
      // 遅れて見えてしまう（ユーザー報告：カーソルの十字に円の追従が遅れる）。
      // pointermoveの時点でこの1回だけ即座に描き直すことで、次のrAFの巡目を
      // 待たずに反映する——マウスのみ（タッチはホバー自体が存在しない）。
      if (ev.pointerType === "mouse") this.render();
      return;
    }
    const p = this.toNormalized(ev.clientX, ev.clientY);

    if (this.state.mode === "drawing" && this.state.activeMemoId) {
      this.store.addPointToLastStroke(this.state.activeMemoId, p);
    } else if (this.state.mode === "moving" && this.state.movingMemoId && this.state.lastPoint) {
      const dx = p.x - this.state.lastPoint.x;
      const dy = p.y - this.state.lastPoint.y;
      this.store.translateMemo(this.state.movingMemoId, dx, dy, this.inputClamp());
      this.state.lastPoint = p;
    } else if (this.state.mode === "erasing") {
      this.state.lastPoint = p;
      // ドラッグ中はeraserHoverPointを更新しない実装のままだと、指を離した瞬間
      // （mode==="erasing"→"idle"、lastPoint=null）にプレビュー円がeraserHoverPoint
      // 側へ切り替わり、そこがドラッグ開始前の古い位置のまま止まっていたため、
      // 消し終えた場所から消し始めた位置へ一瞬戻って見えていた（ユーザー報告・
      // 実機再現確認：カーソルを消してからは特に目立つ）。ドラッグ中も一緒に
      // 更新しておくことで、離した直後も今の位置のまま途切れなく見えるようにする。
      this.eraserHoverPoint = p;
      this.ensureUndoSnapshot();
      this.store.eraseAt(p, this.getToolState().eraserRadius / this.effectiveScale());
    }
  };

  /** 何も操作していない間（mode==="idle"）だけ呼ばれる。消しゴムでは当たり範囲の
   *  プレビュー円（eraserHoverPoint）を更新する——クリックして実際に消し始める
   *  まで大きさが分からない問題の解消（ユーザー指示）。タッチには「押さずに触れる」
   *  状態が無いため、pointerType==="mouse"のときだけ働く——タッチ側は従来どおり
   *  実際に触れて操作を始めたときに表示する。 */
  private updateHoverInfo(ev: PointerEvent): void {
    const tool = this.getToolState().tool;
    const isMouse = ev.pointerType === "mouse";
    this.eraserHoverPoint = isMouse && tool === "eraser" ? this.toNormalized(ev.clientX, ev.clientY) : null;
  }

  /** マウスがキャンバスの外に出たら、消しゴムのプレビュー円も消す
   *  （出しっぱなしにならないように）。 */
  private onPointerLeave = (): void => {
    this.eraserHoverPoint = null;
    this.pointerInsideFrame = true;
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.activePointerId) return; // ピンチ中の指、または元々無関係な指
    this.activePointerId = null;
    this.endSinglePointerGesture();
  };

  /**
   * 何も選択していない状態（テキスト編集中でも、道具でのドラッグ中でもない）で
   * 印字可能な文字キーが押されたら、その場でテキスト入力を始める（ユーザー指示）。
   * 書き始める位置は常に円そのものの中心(0,0)——空いているマスを探す方式は、
   * 狙いどおりの見た目に細かく調整するのが難しくユーザー自身が調整を諦めたため
   * 単純化した。罫線の上に乗るかどうかも気にしない（ユーザー指示）。既存の文字と
   * 重なってもよい。ショートカット（Ctrl/Cmd/Alt併用）や、他の入力欄
   * （色ピッカー・招待リンクの入力欄など）にフォーカスがある間は横取りしない。
   */
  /** iOS Safariはソフトキーボードが開いてもcontainerのCSS上のサイズ自体は
   *  変えず、代わりに実際に見えている範囲（visual viewport）だけを縮める
   *  ——このケースはResizeObserver（containerのサイズ監視）では捉えられない
   *  ため、window.visualViewportのresize/scrollも別途見て、開いている
   *  text-editor-overlayを再配置する（ユーザー指摘：タップ位置から離れた所に
   *  表示される）。 */
  private onVisualViewportChange = (): void => {
    this.repositionTextEditor?.();
  };

  /**
   * issue #89: PC版でCtrl+Z（Cmd+Z）による直前操作の取り消し（undo）、
   * Ctrl+Shift+Z（Cmd+Shift+Z）によるやり直し（redo）を使えるようにする。
   * 印字可能キー1文字での新規テキストメモ作成（下記）と同じ関数にまとめ、
   * 「今表示中のタブのキャンバスか」「他の入力欄にフォーカスが無いか」の
   * ガードを共有する——ルーム名の入力欄などにフォーカスがある間は、ブラウザ
   * 標準のundoを横取りしないよう素通りする。
   */
  private onGlobalKeyDown = (ev: KeyboardEvent): void => {
    if (this.textEditor || this.state.mode !== "idle") return;
    if (this.canvas.offsetParent === null) return; // 今表示中のタブのキャンバスでなければ無視
    const active = document.activeElement;
    const isEditableFocus =
      active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active as HTMLElement | null)?.isContentEditable;

    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === "z" && !isEditableFocus) {
      ev.preventDefault();
      if (ev.shiftKey) this.store.redo();
      else this.store.undo();
      // undo()と同じ理由（そちらのコメント参照）で、書き込みセッションを打ち切る。
      this.closeWritingSession();
      return;
    }

    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key.length !== 1) return; // 矢印・Enter・Tab等の非文字キーは無視
    if (isEditableFocus) return;
    ev.preventDefault();
    this.openTextEditor({ x: 0, y: 0 }, null, ev.key);
  };

  /** モーダル等のcapture段で拾った文字を、このキャンバスの中央入力として開始する。 */
  startTextInputAtCenter(initialText: string): void {
    if (!this.interactive || this.textEditor || this.state.mode !== "idle" || initialText.length !== 1) {
      return;
    }
    this.openTextEditor({ x: 0, y: 0 }, null, initialText);
  }

  /** フィット(1倍)より拡大しているか。main.tsがヘッダー/ツールバー（画面全体に
   *  広がったキャンバスの上に固定オーバーレイとして乗る）を薄くするかどうかの
   *  判定に使う（ユーザー指示：ズーム中は下の絵が見えるよう薄くしたい）。 */
  isZoomed(): boolean {
    return this.viewZoom > MIN_ZOOM;
  }

  /** キーボード直上に固定表示中（issue #87、pointer:coarse時の
   *  text-editor-overlay--fixed-bottom）か。main.tsがこの間ツールバーを
   *  隠すかどうかの判定に使う——入力欄がツールバーとほぼ同じ場所に不透明な
   *  カードとして重なって表示されるため（ユーザー指示）。 */
  isEditingTextFixedBottom(): boolean {
    return this.textEditor?.classList.contains("text-editor-overlay--fixed-bottom") ?? false;
  }

  /** 現在のフレームと殴り書きを、余白とロゴを含む正方形PNGへする。 */
  async createExportImage(): Promise<Blob> {
    this.finishTextEditingIfOpen();

    // 書き出しは閲覧中のズーム・パンやマウスカーソルに左右されない「作品」状態にする。
    const previousZoom = this.viewZoom;
    const previousPan = { ...this.viewPan };
    const previousEraserHoverPoint = this.eraserHoverPoint;
    this.viewZoom = MIN_ZOOM;
    this.viewPan = { x: 0, y: 0 };
    this.eraserHoverPoint = null;

    // getImageData等が例外を投げた場合でも、上で退避した表示状態
    // （ズーム・パン・ホバー表示）を必ず元に戻す——finallyが無いと、
    // 書き出しの途中で失敗した時にMIN_ZOOM/(0,0)へ固定されたまま
    // 戻らなくなる。
    let output: HTMLCanvasElement;
    try {
      this.render();

      const source = this.canvas;
      const sourceCtx = source.getContext("2d", { willReadFrequently: true })!;
      const pixels = sourceCtx.getImageData(0, 0, source.width, source.height);
      let minX = source.width;
      let minY = source.height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < source.height; y += 1) {
        for (let x = 0; x < source.width; x += 1) {
          if (pixels.data[(y * source.width + x) * 4 + 3] === 0) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      output = document.createElement("canvas");
      output.width = 1200;
      output.height = 1200;
      const ctx = output.getContext("2d")!;
      ctx.fillStyle = "#f4f0e8";
      ctx.fillRect(0, 0, output.width, output.height);

      if (maxX >= minX && maxY >= minY) {
        const cropWidth = maxX - minX + 1;
        const cropHeight = maxY - minY + 1;
        const availableWidth = 1056;
        const availableHeight = 940;
        const scale = Math.min(availableWidth / cropWidth, availableHeight / cropHeight);
        const width = cropWidth * scale;
        const height = cropHeight * scale;
        ctx.drawImage(source, minX, minY, cropWidth, cropHeight, (1200 - width) / 2, 54 + (availableHeight - height) / 2, width, height);
      }

      ctx.fillStyle = "#302d29";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = '600 42px "Klee One", "Noto Sans JP", sans-serif';
      ctx.fillText("円相", 600, 1080);
    } finally {
      this.viewZoom = previousZoom;
      this.viewPan = previousPan;
      this.eraserHoverPoint = previousEraserHoverPoint;
      this.render();
    }

    return new Promise<Blob>((resolve, reject) => {
      output.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("画像の生成に失敗しました"))), "image/png");
    });
  }

  /** 手描き線は含めず、今あるアクティブな文字メモだけを空行で区切って返す。 */
  getExportText(): string {
    return this.store
      .getActive()
      .filter((memo) => memo.kind === "text")
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((memo) => memo.text)
      .filter((text) => text.trim().length > 0)
      .join("\n\n");
  }

  render(): void {
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    if (this.interactive) {
      if (this.state.mode === "idle" && !this.pointerInsideFrame) {
        // 横長ウィンドウでの円フレーム左右の余白等、<canvas>要素の範囲内だが
        // 実際の輪郭の外側にマウスがある間は、描画/移動可能に見えるカーソルを
        // 出さない（不具合報告：余白でもcrosshair/grabに変化してしまう）。
        // 既にジェスチャーが始まっている場合(mode!=="idle")は、pointer capture
        // により輪郭の外へ多少はみ出しても従来通りgrabbing等を保つ。
        this.canvas.style.cursor = "default";
      } else {
        // 移動道具を選んでいる間はつかむ/つかんでいるカーソルにして、動かせることを示す。
        // 消しゴムは当たり範囲そのものをプレビュー円で描いている（下のeraserCursorPoint
        // 参照）ため、OS純正の十字カーソルを重ねて出さない——円だけで範囲が
        // 分かるようにする（ユーザー指示）。
        const tool = this.getToolState().tool;
        this.canvas.style.cursor =
          tool === "move"
            ? this.state.mode === "moving"
              ? "grabbing"
              : "grab"
            : tool === "eraser"
              ? "none"
              : "crosshair";
      }
    }
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w / this.dpr, h / this.dpr);
    ctx.translate(this.frame.centerPx.x + this.viewPan.x, this.frame.centerPx.y + this.viewPan.y);
    // ピンチズームの倍率をここで1回だけ適用する。以降の描画（メモのストローク・
    // 罫線紙・フレームのクリップパス・グロー・消しゴムカーソル等）はすべて
    // このtransformの上に乗るため、個々の描画コードは一切変更不要で自動的に
    // ズームが反映される（`r = this.frame.scale`もこれまで通りでよい）。
    ctx.scale(this.viewZoom, this.viewZoom);

    const shape = this.frame.currentShape();
    const r = this.frame.scale;
    const activeMemos = this.store.getActive();

    // 枠線は撤去し、CSSのdrop-shadow（.circle-canvas、style.css）で紙の輪郭に
    // 沿って浮かせる見た目に置き換えた（ユーザー指示）——ここでは紙以外
    // 何も塗らない。枠の外にはみ出さないようクリップだけする。
    ctx.save();
    ctx.clip(this.frame.framePath);

    // Oval/Squareはクリップ境界がradius基準の正方形より外まで張り出すため、
    // 紙面もmaxReachぶん広めに塗る（クリップで結局切り取られるので広めに塗って
    // 問題はない）——でないと丸眼鏡以外で、枠の内側なのに紙が届かず背景色が
    // 透けて見える帯ができてしまう（ユーザー指摘）。
    drawRuledPaper(ctx, r, r * shape.maxReach);

    for (const memo of activeMemos) {
      renderMemoAt(ctx, memo, r, 1, this.minRenderedTextFontPx);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";

    if (this.state.mode === "moving" && this.state.lastPoint) {
      drawRadialGlow(ctx, this.state.lastPoint.x * r, this.state.lastPoint.y * r, 22, TRACE_GLOW);
    }

    // 消しゴムの当たり範囲を示すカーソル。実際に消している最中はstate.lastPoint、
    // それ以外（マウスでホバーしているだけ）はeraserHoverPointを使う——クリックして
    // 実際に消し始めるまで大きさが分からない問題を解消するため（ユーザー指示）。
    const eraserCursorPoint = this.state.mode === "erasing" ? this.state.lastPoint : this.eraserHoverPoint;
    if (eraserCursorPoint) {
      const p = { x: eraserCursorPoint.x * r, y: eraserCursorPoint.y * r };
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.getToolState().eraserRadius / this.viewZoom, 0, Math.PI * 2);
      ctx.fillStyle = ERASER_CURSOR_FILL;
      ctx.fill();
      ctx.strokeStyle = ERASER_CURSOR;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    ctx.restore(); // clip

    if (this.interactive && activeMemos.length === 0) {
      // 中心点（ここが書ける領域の中心、という目印）。文字の案内はDOM側
      // （.canvas-empty-state、syncEmptyState参照）へ移したので、canvasに描くのは
      // この点だけ。
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fillStyle = CENTER_DOT;
      ctx.fill();
    }

    ctx.restore(); // translate + setTransform

    // DOM側の案内（自由に書いてみる）の出し入れ。
    this.syncEmptyState(activeMemos.length);
  }

  /** このインスタンスを使い終えたら呼ぶ。ResizeObserverと`window`に登録した
   *  ポインタリスナーを解除する——これを呼ばずにcanvas要素だけDOMから外すと、
   *  監視・リスナーがこのインスタンス（とstore等それが閉じ込めているもの）を
   *  永久に参照し続けてしまう（SMUIの右レンズはルーム切替のたびに新しい
   *  CircularCanvasへ差し替わるため、古い方を破棄せず放置するとリークする）。 */
  destroy(): void {
    this.resizeObserver.disconnect();
    if (this.interactive) {
      this.canvas.removeEventListener("pointerdown", this.onPointerDown);
      this.canvas.removeEventListener("pointermove", this.onPointerMove);
      this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
      window.removeEventListener("pointerup", this.onPointerUp);
      window.removeEventListener("pointercancel", this.onPointerUp);
      window.removeEventListener("keydown", this.onGlobalKeyDown);
      window.removeEventListener("pointerdown", this.onGlobalPointerDown);
      window.removeEventListener("pointermove", this.onGlobalPointerMove);
      window.removeEventListener("pointerup", this.onGlobalPointerUp);
      window.removeEventListener("pointercancel", this.onGlobalPointerUp);
      window.visualViewport?.removeEventListener("resize", this.onVisualViewportChange);
      window.visualViewport?.removeEventListener("scroll", this.onVisualViewportChange);
    }
    this.textEditor?.remove();
    this.restoreBodyScroll?.();
    this.stopEmptyStateHintRotation();
    this.emptyStateEl?.remove();
    this.container.classList.remove("canvas-host");
    this.canvas.remove();
  }
}
