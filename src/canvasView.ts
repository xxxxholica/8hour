import { FrameGeometry } from "./frameGeometry";
import {
  circleIntersectsBox,
  computeMemoDisplayOffset,
  distance,
  isInsideClamp,
  pointNearStrokes,
} from "./geometry";
import { drawRadialGlow, renderMemoAt, rowTextBaseline } from "./memoRenderer";
import type { MemoStore } from "./memoStore";
import { drawRuledPaper } from "./paper";
import {
  fontPxForRender,
  groupRowsByParagraph,
  LINE_HEIGHT_MULTIPLIER,
  clampLineLeft,
  clampRowTop,
  layoutText,
  lineRowPitch,
  minLineWrapWidthPx,
  normalizedBoxSize,
  snapToRowTop,
  TEXT_FONT_FAMILY,
} from "./textLayout";
import {
  autoConvertBullet,
  backspaceAtMarker,
  continueList,
  indentLines,
  isBlankText,
  moveItemToSlot,
  outdentLines,
  renumber,
  startNextLine,
  stripTrailingBlankLines,
  toggleMarker,
  type EditState,
} from "./textList";
import { isDarkThemeActive, resolveInkColor } from "./theme";
import { REFERENCE_RADIUS } from "./toolStyle";
import type { ToolbarTool } from "./toolbar";
import type { Memo, Point, TextMemo } from "./types";

const TRACE_GLOW = "oklch(22% 0.012 55 / 0.14)";
const TRACE_GLOW_DARK = "oklch(92% 0.006 75 / 0.18)";
const ERASER_CURSOR = "oklch(22% 0.012 55 / 0.3)";
const ERASER_CURSOR_DARK = "oklch(92% 0.006 75 / 0.4)";
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

function pointerMidpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** ソフトウェアキーボードが出るデバイス（openTextEditorのモバイル向け固定
 *  配置分岐、issue #87）かどうかの判定。画面幅ではなくポインタ精度で見るのは、
 *  iPad等の広い画面のタッチデバイスも対象に含めたいため。 */
function isCoarsePointerDevice(): boolean {
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

/** 行モードの書き込み領域（lineTextArea）の、上下の余白（画面px）。 */
const TEXT_AREA_MARGIN_Y_PX = 28;

/** 行モードの書き込み領域の、左右の余白（画面px）。上下より広く、画面幅に応じて
 *  広げる（幅の8%、ただし40〜120px）——文章が画面の端に張り付かないようにする。 */
function textAreaMarginX(frameWidthPx: number): number {
  return Math.min(120, Math.max(40, frameWidthPx * 0.08));
}

/** 進行中のピンチ操作の起点（開始時の指間距離・中点・その時点のズーム/パン）。 */
interface PinchState {
  startDist: number;
  startZoom: number;
  startMid: Point;
  startPan: Point;
}

interface ToolState {
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
interface CircularCanvasOptions {
  /** 道具バーで何も選ばずキーボードから直接文字を打ち始めた時
   *  （onGlobalKeyDown、印字可能キー1文字での新規テキストメモ作成）に呼ぶ。
   *  実際にはテキストメモの作成が始まっているのに道具バー上は元の道具
   *  （多くは「道具なし」）のまま変わらず見えていた（ユーザー指摘）ため、
   *  呼び出し側（main.ts）がここで道具バーの表示をテキストへ切り替える。 */
  onAutoTextToolStart?: () => void;
  /** 行モードの書き込み領域（ガイド罫・折り返し・配置の範囲）から除く、画面の上端・
   *  下端のUI（ツールバー・カラーバー等）が占める高さ（画面px、キャンバスの上端／下端
   *  から測る）。省略時は0。 */
  getTextAreaInsetsPx?: () => { top: number; bottom: number };
  /** キャンバス中央の背景に大きく描くタイマー文字列（例："08:00:00"）。 */
  getBackgroundTimerText?: () => string;
}

interface TimerSlotAnim {
  fromChar: string;
  toChar: string;
  startTime: number;
  durationMs: number;
  /** 1 = 時間が巻き戻る（古い数字が下へ降り、新しい数字が上から降りてくる）、
   *  -1 = カウントダウンで進む（古い数字が上へ抜け、新しい数字が下から上がる）。 */
  direction: 1 | -1;
}

export class CircularCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = Math.max(1, window.devicePixelRatio || 1);
  private resizeObserver: ResizeObserver;
  /** フレーム形状・サイズ計算・縁取りの描画をまとめて持つ（canvasView.tsが
   *  肥大化したための整理、Refactor。src/frameGeometry.ts参照）。 */
  private frame: FrameGeometry;
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
  /** 既存のテキストメモを編集している間、そのメモのid（新規入力中・編集していない間はnull）。
   *  編集中のメモをキャンバスにも描き続けると、textareaの下に編集前の文字が
   *  重なって見えてしまう（ユーザー報告）ため、描画ループ（render）でスキップする。
   *  確定・キャンセルのどちらでも、commit内でnullへ戻して通常の描画に戻す。 */
  private editingMemoId: string | null = null;
  /** モバイルの行モード編集中に、キーボード直上へ出すアイコンツールバー
   *  （リストの記号・インデント・確定）。編集を終えるとnullへ戻す。 */
  private textEditorToolbar: HTMLElement | null = null;
  /** 移動道具で、複数行の行モードのメモの1行（段落）をつかんでドラッグしている間の状態
   *  （Notionのように、行をドラッグ＆ドロップして入れ替える）。しきい値を超えて動くまで
   *  （activeがfalseの間）は何も変わらない。slotは、離したときに行が入るすき間
   *  （0〜段落数、「slot番目の段落の手前」）。 */
  private lineDrag: {
    from: number;
    start: Point;
    pointer: Point;
    active: boolean;
    slot: number;
    /** つかんだ行の、折り返し済みの行。ドラッグ中の見た目（ゴースト）に使う。 */
    rows: string[];
    /** つかんだ行のインク色。 */
    color: string;
    /** ドラッグ表示の基準左端・幅・フォントサイズ・行間倍率。 */
    left: number;
    width: number;
    fontSize: number;
    lineHeight: number;
    /** 各スロットの境界のy座標（表示オフセット反映済みの正規化座標）。長さは段落数+1。 */
    slotYs: number[];
  } | null = null;
  private applyEditingTextColor: ((nextColor: string) => void) | null = null;
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
   *  現在位置を持ち、2本目の指が乗るとピンチ開始（「移動・並べ替え」道具の
   *  間だけ、onGlobalPointerDown参照）。 */
  private pinchPointers = new Map<number, Point>();
  private viewZoom = 1;
  private viewPan: Point = { x: 0, y: 0 };
  private prevTimerText: string | null = null;
  private timerSlotAnims: Array<TimerSlotAnim | null> = [];
  private timerDisplayAlpha: number | null = null;
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
  /** 一連のマルチタッチ（最初の指が触れてから関わった指が全て離れるまで）で同時に
   *  触れていた指の最大本数。2本以上の指が関わったタップは、Safari純正のダブルタップ
   *  ズームと誤認されないようonGlobalPointerUpでpreventDefaultするために使う。 */
  private tapGesturePeakCount = 0;
  private getTextAreaInsetsPx: (() => { top: number; bottom: number }) | undefined;
  private onAutoTextToolStart: (() => void) | undefined;
  private getBackgroundTimerText: (() => string) | undefined;
  private locked = false;

  setLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    if (locked) {
      this.closeWritingSession();
      this.finishTextEditingIfOpen();
      this.activePointerId = null;
      this.endSinglePointerGesture(true);
      this.eraserHoverPoint = null;
    }
  }

  constructor(
    container: HTMLElement,
    store: MemoStore,
    getToolState: () => ToolState,
    options: CircularCanvasOptions = {}
  ) {
    this.container = container;
    this.store = store;
    this.getToolState = getToolState;
    this.getTextAreaInsetsPx = options.getTextAreaInsetsPx;
    this.onAutoTextToolStart = options.onAutoTextToolStart;
    this.getBackgroundTimerText = options.getBackgroundTimerText;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "circle-canvas";
    this.canvas.style.fontVariantNumeric = "lining-nums tabular-nums";
    this.canvas.style.fontFeatureSettings = '"lnum" 1, "tnum" 1';
    this.container.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context is not available");
    this.ctx = ctx;

    this.frame = new FrameGeometry(this.canvas, this.container, this.dpr);
    // ウィンドウのリサイズだけでなく、フッターの折り返しやフォント読み込みによる
    // レイアウト変化など、コンテナの実サイズが変わるあらゆるタイミングを動的に捉える
    this.resizeObserver = new ResizeObserver(() => {
      this.frame.resize();
      this.frame.syncScaleForMemos(this.store.getActive());
      // レイアウトが変わった後に古いズーム・パン量を引きずると見た目が破綻する
      // ため、コンテナの実サイズが変わった場合はリセットする（画面回転など）。
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
      // モバイルでソフトキーボードが開閉するとcontainerの実サイズが変わり
      // ここが発火する。text-editor-overlayを開いたままだと、位置がタップ時点の
      // 古いフレームのまま取り残されてしまうため、開いていれば今のフレームに
      // 合わせて再配置する（ユーザー指摘：タップ位置から離れた所に表示される）。
      this.repositionTextEditor?.();
    });
    this.resizeObserver.observe(this.container);

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
  }

  /** 現在の書き込みクランプ関数。画面全体の矩形範囲のclampをそのまま使う。 */
  private inputClamp(): (p: Point) => Point {
    return this.frame.viewportClamp();
  }

  /**
   * 行モードの書き込み領域（正規化座標）。ガイド罫を引く範囲であり、新しい行モードの
   * メモの配置・折り返しの右端もこの範囲に収める。画面の上下左右に余白
   * （TEXT_AREA_MARGIN_PX）を取り、上端・下端はツールバー等のUI
   * （getTextAreaInsetsPx）が占める高さも避ける。極端に狭い画面では、領域が
   * 成り立たなくなる前に、使用可能領域（usableHalfExtents）全体へ戻す。
   */
  private lineTextArea(): { left: number; right: number; top: number; bottom: number } {
    const s = this.frame.scale;
    const c = this.frame.centerPx;
    const insets = this.getTextAreaInsetsPx?.() ?? { top: 0, bottom: 0 };
    const mx = textAreaMarginX(this.frame.width);
    const my = TEXT_AREA_MARGIN_Y_PX;
    const area = {
      left: (mx - c.x) / s,
      right: (this.frame.width - mx - c.x) / s,
      top: (Math.max(0, insets.top) + my - c.y) / s,
      bottom: (this.frame.height - Math.max(0, insets.bottom) - my - c.y) / s,
    };
    if (area.right - area.left < 0.3 || area.bottom - area.top < 0.3) {
      const { halfW, halfH } = this.frame.usableHalfExtents();
      return { left: -halfW, right: halfW, top: -halfH, bottom: halfH };
    }
    return area;
  }

  /** ページ上の行モードのテキストメモを、上端のy座標が小さい順（上から順）に返す。 */
  private getLineMemosSorted(): TextMemo[] {
    return this.store
      .getActive()
      .filter((m): m is TextMemo => m.kind === "text" && m.layout === "line")
      .sort((a, b) => {
        const topA = a.y + this.memoDisplayOffset(a).y - a.boxHeight / 2;
        const topB = b.y + this.memoDisplayOffset(b).y - b.boxHeight / 2;
        return topA - topB;
      });
  }

  /**
   * ページの文章の本流（行モードのテキストメモ）のうち、一番下のものを返す。
   * 新しい文字は、位置を指定せず、常にこの末尾へ続けて書く（無ければ書き込み領域の左上から）。
   */
  private findFlowMemo(): TextMemo | null {
    const memos = this.getLineMemosSorted();
    return memos.length > 0 ? memos[memos.length - 1] : null;
  }

  /**
   * 新しい文字を書き始める（テキスト道具で何もない所をタップしたとき、道具を選ばず
   * キーボードで打ち始めたとき）。書く位置は指定できない：本流のメモがあればその
   * 末尾の次の行から続け、無ければ書き込み領域の左上の行から始める。
   * 1つのメモは1色なので、今選んでいる色が本流の最後のメモの色と違うときは、そのメモに
   * 続けず、すぐ下の行から新しいメモ（今の色）を始める（直前の行がリストなら次の項目の
   * 記号も引き継ぐ）。
   * typedは、キーボードで打ち始めたときの最初の1文字。
   */
  private openTextAtFlowEnd(typed?: string): void {
    const flow = this.findFlowMemo();
    if (flow && flow.color !== this.getToolState().color) {
      const area = this.lineTextArea();
      const offset = this.memoDisplayOffset(flow);
      const pitch = lineRowPitch(flow.fontSize, flow.lineHeight ?? LINE_HEIGHT_MULTIPLIER);
      const nextPrefix = startNextLine(flow.text).slice(flow.text.length + 1);
      const initial = nextPrefix || typed ? nextPrefix + (typed ?? "") : undefined;
      // 下端ちょうどだと浮動小数点の誤差で上の行に丸められることがあるため、次の行の
      // 中ほどを指す（openTextEditorが行の上端へ揃える）。
      this.openTextEditor(
        { x: area.left, y: flow.y + offset.y + flow.boxHeight / 2 + pitch * 0.25 },
        null,
        initial
      );
      return;
    }
    if (flow) {
      const offset = this.memoDisplayOffset(flow);
      this.openTextEditor(
        { x: flow.x + offset.x, y: flow.y + offset.y },
        flow,
        startNextLine(flow.text) + (typed ?? "")
      );
      return;
    }
    const area = this.lineTextArea();
    this.openTextEditor({ x: area.left, y: area.top }, null, typed);
  }

  /** 現在のウィンドウサイズに応じたメモの表示位置オフセット（正規化単位）。 */
  private memoDisplayOffset(memo: Memo): Point {
    const { halfW, halfH } = this.frame.usableHalfExtents();
    return computeMemoDisplayOffset(memo, halfW, halfH);
  }

  /** ピンチズームの倍率を加味した、正規化座標→画面px変換の実効スケール。 */
  private effectiveScale(): number {
    return this.frame.scale * this.viewZoom;
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
      const offset = this.memoDisplayOffset(memo);
      const localP = offset.x === 0 && offset.y === 0 ? p : { x: p.x - offset.x, y: p.y - offset.y };
      if (memo.kind === "stroke") {
        if (pointNearStrokes(localP, memo.strokes, threshold)) return memo;
      } else if (
        circleIntersectsBox(localP, threshold, {
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

  private eraseAtPoint(p: Point): void {
    this.state.lastPoint = p;
    // ドラッグ中はeraserHoverPointを更新しない実装のままだと、指を離した瞬間
    // （mode==="erasing"→"idle"、lastPoint=null）にプレビュー円がeraserHoverPoint
    // 側へ切り替わり、そこがドラッグ開始前の古い位置のまま止まっていたため、
    // 消し終えた場所から消し始めた位置へ一瞬戻って見えていた（ユーザー報告・
    // 実機再現確認：カーソルを消してからは特に目立つ）。ドラッグ中も一緒に
    // 更新しておくことで、離した直後も今の位置のまま途切れなく見えるようにする。
    this.eraserHoverPoint = p;
    this.ensureUndoSnapshot();
    const radius = this.getToolState().eraserRadius / this.effectiveScale();
    // 行モードのテキストは行単位で消す（下のeraseTextLines）ので、ストア側では扱わない。
    this.store.eraseAt(p, radius, (m) => this.memoDisplayOffset(m), true);
    this.eraseTextLines(p, radius);
  }

  private onPointerDown = (ev: PointerEvent): void => {
    ev.preventDefault();
    // テキスト入力中にキャンバスをタップしたら、入力を確定して閉じる。
    // pointerdownのpreventDefault（上）はブラウザ既定のフォーカス移動を止めて
    // しまうため、textareaが自然にblurせず開いたままになっていた（実機相当の
    // ブラウザで再現確認）。ここで明示的にblurして、blurハンドラ（commit）に
    // 確定させる。このタップ自体では新しい操作は始めない。
    if (this.textEditor) {
      this.textEditor.blur();
      return;
    }
    if (this.locked) return;
    // ピンチ中、または既に他の指が1本指ジェスチャーを進行させている間は、
    // 2本目以降の指をここでは扱わない——ピンチの検知・開始はキャンバスの
    // 外側も含めてonGlobalPointerDownがwindowレベルで一括して行う。
    if (this.state.mode === "pinching" || this.activePointerId !== null) return;

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
    const p = raw;

    const tool = this.getToolState().tool;
    // 道具なし（選択中の道具をもう一度押して解除した状態、toolbar.ts
    // setTool参照）の間は、キャンバスへの描画・消去・移動操作を一切
    // 受け付けない（ユーザー指示）——いずれかの道具を選び直すまでの
    // 待機状態として扱う。
    if (tool === "none") return;
    // 新しいジェスチャーの開始（issue #89のundo/redo、undoSnapshotTaken参照）。
    this.undoSnapshotTaken = false;

    if (tool === "eraser") {
      this.state.mode = "erasing";
      this.eraseAtPoint(p);
      return;
    }

    const hitMemo = this.hitTestMemo(p);

    if (tool === "move") {
      // 移動道具：既存のメモに触れた場合だけドラッグを開始する。何もない場所をタップしても
      // 新規作成はしない（道具の役割を「動かすだけ」に絞るため）
      if (hitMemo) {
        this.state.mode = "moving";
        // 複数行の行モードのメモは、つかんだ行をドラッグして入れ替える（メモ自体は動かさない）。
        if (hitMemo.kind === "text") {
          // テキストは位置を自由に動かせない（文章の流れから外れてしまうため）。できるのは
          // 行の入れ替えだけ。入れ替えられない（1行だけ・空行・旧バージョンの自由配置）
          // ときは何もしない。
          const paragraphIndex = this.lineParagraphAt(hitMemo, p);
          if (paragraphIndex === null) {
            this.state.mode = "idle";
            return;
          }
          this.startLineDrag(paragraphIndex, p);
          return;
        }
        this.state.movingMemoId = hitMemo.id;
        this.state.lastPoint = p;
      }
      return;
    }

    if (tool === "text") {
      // 既存のテキストメモに触れた場合は編集を開く。
      if (hitMemo && hitMemo.kind === "text") {
        const offset = this.memoDisplayOffset(hitMemo);
        this.openTextEditor({ x: hitMemo.x + offset.x, y: hitMemo.y + offset.y }, hitMemo);
      } else {
        // 何もない所をタップしても、その位置には書かない（位置を指定する自由配置は
        // 廃止した）。ページの文章の末尾へ続けて書く。
        this.openTextAtFlowEnd();
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
      const memo = this.store.createMemo(
        p,
        { tool: tool as "pen" | "marker", color, lineWidth },
        Date.now(),
        this.frame.usableHalfExtents()
      );
      this.state.activeMemoId = memo.id;
    }
    if (this.state.idleTimer !== null) window.clearTimeout(this.state.idleTimer);
  };

  /** ページのどこにタッチしても（キャンバス要素の外側でも）2本目の指を検知
   *  できるよう、windowレベルですべてのpointerdownを監視する。
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
   *  始める——ペン・マーカー・消しゴム・テキストの間に指が2本乗っても
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
    if (this.canvas.offsetParent === null) return; // 今表示中のタブのキャンバスでなければ無視

    const pos = { x: ev.clientX, y: ev.clientY };
    if (this.pinchPointers.size === 0) {
      this.tapGesturePeakCount = 0;
    }
    this.pinchPointers.set(ev.pointerId, pos);
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
   *  再度乗っ取ってくることがあるため（onGlobalPointerDownのコメント参照）。 */
  private onGlobalPointerMove = (ev: PointerEvent): void => {
    if (!this.pinchPointers.has(ev.pointerId)) return;
    this.pinchPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pinchPointers.size >= 2) {
      ev.preventDefault();
    }
    if (this.state.mode === "pinching") {
      this.updatePinch();
    }
  };

  /** ピンチ対象として追跡中の指が離れるたびに呼ぶ（windowレベル）。 */
  private onGlobalPointerUp = (ev: PointerEvent): void => {
    if (!this.pinchPointers.delete(ev.pointerId)) return;
    // Safariのダブルタップズームは指の移動量ではなく、連続する2回のタップの
    // 間隔（touchend/pointerupのタイミング）で判定される——onGlobalPointerMove
    // 側のpreventDefault()（指が動く間だけ効く）では止められないため、こちらも
    // このマルチタッチの塊に2本以上の指が関わっていた間はpreventDefault()する。
    if (this.tapGesturePeakCount >= 2) ev.preventDefault();
    if (this.state.mode === "pinching" && this.pinchPointers.size < 2) {
      // 1本の指を離しただけでは描画を再開しない——残り1本になったら
      // いったんidleに戻し、新しいpointerdownから仕切り直す。
      this.state.mode = "idle";
      this.pinch = null;
    }
  };

  /** 2本目の指が乗った瞬間に呼ぶ。進行中の1本指ジェスチャー（描画・消しゴム・
   *  移動）があれば打ち切ってからピンチの起点を記録する。 */
  private beginPinch(): void {
    if (this.state.mode !== "idle" && this.state.mode !== "pinching") {
      this.endSinglePointerGesture(true);
    }
    this.activePointerId = null; // 1本指ジェスチャーはピンチに譲る
    const [a, b] = [...this.pinchPointers.values()];
    this.state.mode = "pinching";
    this.pinch = {
      startDist: distance(a, b),
      startZoom: this.viewZoom,
      startMid: pointerMidpoint(a, b),
      startPan: { ...this.viewPan },
    };
  }

  /** ピンチ中、いずれかの指が動くたびに呼ぶ。指間距離の変化比でズーム、
   *  中点の移動量でパンを更新する。 */
  private updatePinch(): void {
    if (!this.pinch || this.pinchPointers.size < 2) return;
    const [a, b] = [...this.pinchPointers.values()];
    const dist = distance(a, b);
    const mid = pointerMidpoint(a, b);
    this.viewZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.pinch.startZoom * (dist / this.pinch.startDist)));
    const pan = {
      x: this.pinch.startPan.x + (mid.x - this.pinch.startMid.x),
      y: this.pinch.startPan.y + (mid.y - this.pinch.startMid.y),
    };
    this.viewPan = this.viewZoom <= MIN_ZOOM ? { x: 0, y: 0 } : this.clampPan(pan);
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
    const maxOffsetX = (this.frame.width / 2) * (this.viewZoom - 1);
    const maxOffsetY = (this.frame.height / 2) * (this.viewZoom - 1);
    if (maxOffsetX <= 0 && maxOffsetY <= 0) return { x: 0, y: 0 };
    return {
      x: Math.max(-maxOffsetX, Math.min(maxOffsetX, pan.x)),
      y: Math.max(-maxOffsetY, Math.min(maxOffsetY, pan.y)),
    };
  }

  /** 1本指ジェスチャー（描画・消しゴム・移動）の後始末。onPointerUpと
   *  「2本目の指が乗って途中でピンチに切り替わった」場合の両方から呼ぶ。 */
  private endSinglePointerGesture(cancelled = false): void {
    if (this.lineDrag) {
      if (!cancelled) this.finishLineDrag();
      this.lineDrag = null;
    }
    if (this.state.mode === "erasing" && !cancelled) {
      this.reflowLineMemos();
    }
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

  /** ページ上のすべての行モードのテキストメモから、段落（改行区切りの1行）を上から順に集める。 */
  private collectFlowParagraphs(): {
    memos: TextMemo[];
    paragraphs: { memoId: string; localIndex: number; text: string; color: string; rows: string[] }[];
  } | null {
    const memos = this.getLineMemosSorted();
    if (memos.length === 0) return null;
    const paragraphs: { memoId: string; localIndex: number; text: string; color: string; rows: string[] }[] = [];
    for (const memo of memos) {
      const groups = groupRowsByParagraph(memo.text, memo.textLines);
      if (!groups) return null;
      const lines = memo.text.split("\n");
      for (let i = 0; i < groups.length; i++) {
        paragraphs.push({
          memoId: memo.id,
          localIndex: i,
          text: lines[i] ?? "",
          color: memo.color,
          rows: groups[i],
        });
      }
    }
    return { memos, paragraphs };
  }

  /**
   * 行モードのメモのうち、タップ位置pにある行（段落）の通し番号（ページ全体での番号）を返す。
   * ページ全体で1行しか無い・行モードでない・空行をつかんだ・データが食い違っている場合はnull。
   */
  private lineParagraphAt(memo: TextMemo, p: Point): number | null {
    if (memo.layout !== "line") return null;
    const flow = this.collectFlowParagraphs();
    if (!flow || flow.paragraphs.length < 2) return null;
    const groups = groupRowsByParagraph(memo.text, memo.textLines);
    if (!groups) return null;
    const pitch = lineRowPitch(memo.fontSize, memo.lineHeight ?? LINE_HEIGHT_MULTIPLIER);
    const offset = this.memoDisplayOffset(memo);
    const top = memo.y + offset.y - memo.boxHeight / 2;
    const row = Math.min(memo.textLines.length - 1, Math.max(0, Math.floor((p.y - top) / pitch)));
    const paragraphs = memo.text.split("\n");
    let rowsSoFar = 0;
    for (let i = 0; i < groups.length; i++) {
      rowsSoFar += groups[i].length;
      if (row < rowsSoFar) {
        if (paragraphs[i].trim() === "") return null;
        const globalIdx = flow.paragraphs.findIndex((item) => item.memoId === memo.id && item.localIndex === i);
        return globalIdx >= 0 ? globalIdx : null;
      }
    }
    return null;
  }

  /** 行（段落）のドラッグ＆ドロップを始める（まだ動かしておらず、メモは何も変わらない）。 */
  private startLineDrag(paragraphIndex: number, p: Point): void {
    const flow = this.collectFlowParagraphs();
    if (!flow) return;
    const first = flow.memos[0];
    const fontSize = first.fontSize;
    const lineHeight = first.lineHeight ?? LINE_HEIGHT_MULTIPLIER;
    const pitch = lineRowPitch(fontSize, lineHeight);
    const firstOffset = this.memoDisplayOffset(first);
    const left = first.x + firstOffset.x - first.boxWidth / 2;
    const top = first.y + firstOffset.y - first.boxHeight / 2;
    const width = Math.max(...flow.memos.map((m) => m.boxWidth));
    const slotYs = [top];
    for (const item of flow.paragraphs) {
      slotYs.push(slotYs[slotYs.length - 1] + item.rows.length * pitch);
    }
    const target = flow.paragraphs[paragraphIndex];
    if (!target) return;
    this.lineDrag = {
      from: paragraphIndex,
      start: p,
      pointer: p,
      active: false,
      slot: paragraphIndex,
      rows: target.rows,
      color: target.color,
      left,
      width,
      fontSize,
      lineHeight,
      slotYs,
    };
  }

  /** ドラッグ中のポインタ位置から、行が入るすき間（slot）を更新する。 */
  private updateLineDrag(p: Point): void {
    const d = this.lineDrag;
    if (!d) return;
    d.pointer = p;
    if (!d.active) {
      // 小さな手ぶれ・単なるタップでは入れ替えを始めない。
      if (distance(p, d.start) * this.effectiveScale() < 4) return;
      d.active = true;
    }
    let best = 0;
    for (let k = 1; k < d.slotYs.length; k++) {
      if (Math.abs(d.slotYs[k] - p.y) < Math.abs(d.slotYs[best] - p.y)) best = k;
    }
    d.slot = best;
  }

  /** 行をドロップした位置に合わせて、ページ全体の行の並びを入れ替える（異なる色のブロック間も移動可能）。 */
  private finishLineDrag(): void {
    const d = this.lineDrag;
    if (!d || !d.active) return;
    const flow = this.collectFlowParagraphs();
    if (!flow) return;
    const next = moveItemToSlot(
      flow.paragraphs.map((item) => ({ text: item.text, color: item.color })),
      d.from,
      d.slot
    );
    if (!next) return;
    this.ensureUndoSnapshot();
    this.applyFlowParagraphs(flow.memos, next, { restartAtOne: true });
  }

  /**
   * ページ上の行モードの段落と色の並びから、連続する同色の段落をテキストメモにまとめ直し、
   * 書き込み領域の上端から隙間なく縦に積み直す（番号付きリストの連番も全体をまたいで振り直す）。
   */
  private applyFlowParagraphs(
    existingMemos: TextMemo[],
    items: { text: string; color: string }[],
    options: { restartAtOne?: boolean } = {}
  ): void {
    const trimmed = [...items];
    while (trimmed.length > 0 && isBlankText(trimmed[trimmed.length - 1].text)) {
      trimmed.pop();
    }
    if (trimmed.length === 0) {
      for (const m of existingMemos) this.store.deleteMemo(m.id);
      return;
    }
    const combinedText = trimmed.map((it) => it.text).join("\n");
    const renumberedLines = renumber({ value: combinedText, start: 0, end: 0 }, options).value.split("\n");

    const runs: { color: string; texts: string[] }[] = [];
    for (let i = 0; i < trimmed.length; i++) {
      const color = trimmed[i].color;
      const text = renumberedLines[i] ?? trimmed[i].text;
      const last = runs[runs.length - 1];
      if (last && last.color === color) {
        last.texts.push(text);
      } else {
        runs.push({ color, texts: [text] });
      }
    }

    const area = this.lineTextArea();
    const first = existingMemos[0];
    const fontSize = first?.fontSize ?? this.getToolState().fontSize;
    const lineHeight = first?.lineHeight ?? LINE_HEIGHT_MULTIPLIER;
    const pitch = lineRowPitch(fontSize, lineHeight);
    const firstOff = first ? this.memoDisplayOffset(first) : { x: 0, y: 0 };
    const left = first
      ? clampLineLeft(first.x + firstOff.x - first.boxWidth / 2, area.left, area.right, fontSize)
      : clampLineLeft(area.left, area.left, area.right, fontSize);
    let currentTop = clampRowTop(snapToRowTop(area.top, pitch), pitch, pitch, area.top, area.bottom);
    const wrapRefPx = Math.max(minLineWrapWidthPx(fontSize), (area.right - left) * REFERENCE_RADIUS);
    const extents = this.frame.usableHalfExtents();

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const runText = run.texts.join("\n");
      const { lines, contentWidthPx } = layoutText(this.ctx, runText, fontSize, wrapRefPx);
      const { width, height } = normalizedBoxSize(
        fontSize,
        lines.length,
        Math.max(contentWidthPx, fontSize * 2),
        lineHeight
      );
      const position = { x: left + width / 2, y: currentTop + height / 2 };
      currentTop += height;

      if (i < existingMemos.length) {
        const target = existingMemos[i];
        const off = this.memoDisplayOffset(target);
        const samePos =
          Math.abs(target.x + off.x - position.x) < 1e-6 &&
          Math.abs(target.y + off.y - position.y) < 1e-6 &&
          Math.abs(target.boxWidth - width) < 1e-6 &&
          Math.abs(target.boxHeight - height) < 1e-6;
        if (target.text === runText && target.color === run.color && samePos) {
          continue;
        }
        this.store.materializeDisplayOffset(target.id, off.x, off.y, extents);
        this.store.updateTextMemo(target.id, runText, lines, width, height, {
          position,
          color: run.color,
          layout: "line",
          align: "left",
        });
      } else {
        this.store.createTextMemo(
          position,
          runText,
          lines,
          fontSize,
          width,
          height,
          { color: run.color, align: "left", lineHeight, layout: "line" },
          Date.now(),
          extents
        );
      }
    }
    for (let i = runs.length; i < existingMemos.length; i++) {
      this.store.deleteMemo(existingMemos[i].id);
    }
  }

  /** ページ上の行モードのメモ群を、上端から隙間・重なりなく積み直し、隣接する同色ブロックを統合する。 */
  private reflowLineMemos(): void {
    const flow = this.collectFlowParagraphs();
    if (!flow) return;
    this.applyFlowParagraphs(
      flow.memos,
      flow.paragraphs.map((p) => ({ text: p.text, color: p.color }))
    );
  }

  /**
   * 行モードのメモの内容をtextに置き換える。メモの左端・上端は動かさず、折り返しと
   * 大きさを計算し直す（行単位の消去で使う）。呼び出し側でensureUndoSnapshotしておくこと。
   */
  private applyLineMemoText(memo: TextMemo, text: string): void {
    const offset = this.memoDisplayOffset(memo);
    const left = memo.x + offset.x - memo.boxWidth / 2;
    const top = memo.y + offset.y - memo.boxHeight / 2;
    const area = this.lineTextArea();
    const wrapRefPx = Math.max(minLineWrapWidthPx(memo.fontSize), (area.right - left) * REFERENCE_RADIUS);
    const { lines, contentWidthPx } = layoutText(this.ctx, text, memo.fontSize, wrapRefPx);
    const { width, height } = normalizedBoxSize(
      memo.fontSize,
      lines.length,
      Math.max(contentWidthPx, memo.fontSize * 2),
      memo.lineHeight ?? LINE_HEIGHT_MULTIPLIER
    );
    this.store.materializeDisplayOffset(memo.id, offset.x, offset.y, this.frame.usableHalfExtents());
    this.store.updateTextMemo(memo.id, text, lines, width, height, {
      position: { x: left + width / 2, y: top + height / 2 },
    });
  }

  /**
   * 消しゴムで、行モードのテキストメモのうち、消しゴムの円に触れた行（段落）だけを
   * 消す（文章全体が1つのメモなので、触れた1か所でページの文章がすべて消えないように）。
   * 消した行は空行として残し、他の行は動かさない（詰めてしまうと、ドラッグし続ける間に
   * 下の行が次々と消しゴムの下へ滑り込んで消えてしまうため）。末尾の空行は取り除き、
   * すべての行が消えたらメモごと削除する。
   * 行の幅は、そのメモの箱の幅全体として扱う（短い行の右側の空白に触れても、その行を消す）。
   */
  private eraseTextLines(center: Point, radius: number): void {
    for (const memo of [...this.store.getActive()]) {
      if (memo.kind !== "text" || memo.layout !== "line") continue;
      const groups = groupRowsByParagraph(memo.text, memo.textLines);
      if (!groups) continue;
      const pitch = lineRowPitch(memo.fontSize, memo.lineHeight ?? LINE_HEIGHT_MULTIPLIER);
      const offset = this.memoDisplayOffset(memo);
      const localCenter = { x: center.x - offset.x, y: center.y - offset.y };
      const top = memo.y - memo.boxHeight / 2;
      const touched: boolean[] = [];
      let row = 0;
      for (const g of groups) {
        let hit = false;
        for (let r = 0; r < g.length; r++, row++) {
          const rowBox = { x: memo.x, y: top + (row + 0.5) * pitch, width: memo.boxWidth, height: pitch };
          if (circleIntersectsBox(localCenter, radius, rowBox)) hit = true;
        }
        touched.push(hit);
      }
      if (!touched.some(Boolean)) continue;
      const text = stripTrailingBlankLines(
        memo.text
          .split("\n")
          .map((line, i) => (touched[i] ? "" : line))
          .join("\n")
      );
      if (isBlankText(text)) {
        this.store.deleteMemo(memo.id);
      } else if (text !== memo.text) {
        this.applyLineMemoText(memo, text);
      }
    }
  }

  /** ドラッグ中の行（ポインタに追従する半透明のゴースト）と、ドロップ先を示す線を描く。
   *  中心を原点にtranslate/scale済みのコンテキストに対して呼ぶ。 */
  private renderLineDrag(ctx: CanvasRenderingContext2D, radius: number, dark: boolean): void {
    const d = this.lineDrag;
    if (!d || !d.active) return;

    // ドロップ先を示す線（行と行のすき間）。
    const indicatorY = d.slotYs[d.slot] * radius;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = dark ? "oklch(75% 0.12 250)" : "oklch(58% 0.17 250)";
    ctx.lineWidth = 2.5 / this.viewZoom;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo((d.left - 0.02) * radius, indicatorY);
    ctx.lineTo((d.left + Math.max(d.width, 0.5) + 0.02) * radius, indicatorY);
    ctx.stroke();

    // ポインタに追従するゴースト。
    const fontPx = fontPxForRender(d.fontSize, radius);
    const rowHeight = fontPx * d.lineHeight;
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = resolveInkColor(d.color, dark);
    ctx.font = `${fontPx}px ${TEXT_FONT_FAMILY}`;
    ctx.textAlign = "left";
    const rowBaseline = rowTextBaseline(ctx, rowHeight);
    ctx.textBaseline = rowBaseline.baseline;
    const x = (d.left + (d.pointer.x - d.start.x)) * radius;
    let y = d.pointer.y * radius - (d.rows.length * rowHeight) / 2 + rowBaseline.offset;
    for (const row of d.rows) {
      ctx.fillText(row, x, y);
      y += rowHeight;
    }
    ctx.restore();
  }

  /**
   * 紙の上の行（lineLeft/lineTop）に、テキスト入力用の<textarea>を重ねて表示する。円のクリップの外に
   * 出しても構わないよう画面固定(position:fixed)で配置し、blurした時点で内容を
   * 確定する。Enter・Shift+Enterは改行で、確定はEscape・外タップ・モバイルの✓。
   * editingMemoを渡すと既存のテキストメモの編集になる：元の位置・見た目（フォントサイズ・色）を
   * そのまま使い、内容だけ書き換えて更新する。空にして確定した場合はメモごと削除する。
   * 旧バージョンの自由配置のメモを渡した場合は、行モードのメモとして書き直す。
   * initialTextは、何も選択していない状態でキーボード入力を始めたときに、その最初の
   * 1文字を最初から入った状態で開くために使う（onGlobalKeyDown参照）。editingMemoと
   * 同時に渡した場合は、既存メモの内容ではなくinitialTextで開く（行モードで、既存の
   * メモの続きを書き始めるときに、末尾へ改行を足した内容で開くために使う）。
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
    let currentEditingMemo: TextMemo | null = editingMemo;
    const isAppendingToFlow = editingMemo !== null && initialText !== undefined;
    const { color: toolColor, fontSize: toolFontSize } = this.getToolState();
    let color = currentEditingMemo?.color ?? toolColor;
    const fontSize = currentEditingMemo?.fontSize ?? toolFontSize;
    const lineHeight = currentEditingMemo?.lineHeight ?? LINE_HEIGHT_MULTIPLIER;
    const scaleAtOpen = this.effectiveScale();
    const fontPx = fontPxForRender(fontSize, scaleAtOpen);

    // メモの左端(lineLeft)と上端(lineTop)（どちらも正規化座標）。新規はanchor
    // （openTextAtFlowEnd：書き込み領域の左上）の行に揃える。既存メモは今の表示位置のまま。
    // 確定時もこの2つを固定したまま、幅・高さだけが変わる。旧バージョンの自由配置
    // （中心基準・行グリッド外）のメモを開いた場合も、箱の左端・上端を引き継ぎ、
    // 上端だけ最寄りの行へ揃えて行モードのメモとして書き直す。
    const rowPitch = lineRowPitch(fontSize, lineHeight);
    const area = this.lineTextArea();
    let lineLeft: number;
    let lineTop: number;
    if (currentEditingMemo) {
      const off = this.memoDisplayOffset(currentEditingMemo);
      const rawLeft = currentEditingMemo.x + off.x - currentEditingMemo.boxWidth / 2;
      lineLeft =
        currentEditingMemo.layout === "line"
          ? clampLineLeft(rawLeft, area.left, area.right, fontSize)
          : rawLeft;
      lineTop = currentEditingMemo.y + off.y - currentEditingMemo.boxHeight / 2;
      if (currentEditingMemo.layout !== "line") lineTop = Math.round(lineTop / rowPitch) * rowPitch;
    } else {
      lineLeft = clampLineLeft(anchor.x, area.left, area.right, fontSize);
      const minTop = Math.ceil(area.top / rowPitch) * rowPitch;
      lineTop = Math.max(minTop, snapToRowTop(anchor.y, rowPitch));
    }

    const el = document.createElement("textarea");
    // 紙の上へそのまま書き込むので、枠なし・透明の入力欄にして、確定後の見た目と
    // 重なるようにする。
    el.className = "text-editor-overlay";
    el.rows = 1;
    el.placeholder = "書き込む...";
    el.value = initialText ?? currentEditingMemo?.text ?? "";
    el.style.color = resolveInkColor(color);
    el.style.fontFamily = TEXT_FONT_FAMILY;
    // iOS Safari系は、フォーカスした入力欄のfont-sizeが16px未満だと「読みやすく
    // するため」勝手にページ全体をズームインする——これがタップ直後に画面が
    // アップになり、かつそのズームでvisualViewportが動いた拍子にオーバーレイの
    // 位置計算まで狂う（タップ位置と無関係な場所に出る）原因になっていた
    // （ユーザー報告・実機で再現確認）。モバイルでは実際のfontPx（基準文字サイズ
    // ×実効スケール）が16pxを大きく下回るため常に発火していた。表示上の
    // font-sizeだけ16px以上に底上げしてズームそのものを起こさせないようにする
    // ——確定後にメモとして保存される文字サイズ・折り返し幅はcanvas側の計測
    // （fontSize・layoutText、共にこのDOM要素のstyleとは独立）で決まる。
    // 底上げした分は、transform:scaleで縮めて、画面上の文字の大きさと行の高さを
    // 確定後（行グリッド）と一致させる。iOSのズーム判定はcomputed font-sizeだけを
    // 見るため、transformで見た目を縮めてもズームは起きない。
    const displayFontPx = Math.max(fontPx, 16);
    const lineScaleK = fontPx / displayFontPx;
    el.style.fontSize = `${displayFontPx}px`;
    el.style.lineHeight = `${lineHeight}`;
    document.body.appendChild(el);
    this.textEditor = el;
    this.editingMemoId = currentEditingMemo?.id ?? null;

    // リスト記法（textList.ts）の編集結果をtextareaへ反映する。el.valueを直接
    // 書き換えるとブラウザ標準のundo（Cmd+Z）の履歴が消えるため、変わった範囲だけを
    // execCommandで挿入し、使えない環境ではvalueの書き換えにフォールバックする。
    let applyingEdit = false;
    const readState = (): EditState => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd });
    const applyEdit = (next: EditState): void => {
      const cur = readState();
      if (next.value !== cur.value) {
        const max = Math.min(cur.value.length, next.value.length);
        let head = 0;
        while (head < max && cur.value[head] === next.value[head]) head++;
        let tail = 0;
        while (
          tail < max - head &&
          cur.value[cur.value.length - 1 - tail] === next.value[next.value.length - 1 - tail]
        ) {
          tail++;
        }
        const replacement = next.value.slice(head, next.value.length - tail);
        applyingEdit = true;
        el.setSelectionRange(head, cur.value.length - tail);
        const ok =
          replacement === ""
            ? document.execCommand("delete")
            : document.execCommand("insertText", false, replacement);
        if (!ok || el.value !== next.value) {
          el.value = next.value;
          el.dispatchEvent(new Event("input"));
        }
        applyingEdit = false;
      }
      el.setSelectionRange(next.start, next.end);
    };

    // モバイル（ソフトキーボード）では、キーボード直上にアイコンツールバー（リストの
    // 記号・インデント・確定の✓）を出す。確定は外タップ・✓・Escapeで行う。
    let toolbarEl: HTMLElement | null = null;
    if (isCoarsePointerDevice()) {
      toolbarEl = this.buildTextEditorToolbar({
        bullet: () => applyEdit(toggleMarker(readState(), "bullet")),
        number: () => applyEdit(toggleMarker(readState(), "dot")),
        indent: () => applyEdit(indentLines(readState())),
        outdent: () => applyEdit(outdentLines(readState())),
        done: () => el.blur(),
      });
      document.body.appendChild(toolbarEl);
      this.textEditorToolbar = toolbarEl;
    }

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

    // 紙の上の位置（lineLeft/lineTop）に合わせてtextareaのサイズと位置を更新する。
    // 位置は毎回、その時点のcanvasRect/frame.centerPx/viewPan/scaleから計算し直す——
    // 1回だけ計算してクロージャに固定していると、モバイルでキーボードが開いて
    // containerのサイズが変わりframeが動いた後も古い位置のまま取り残されてしまう
    // （ユーザー指摘：タップ位置から離れた所に表示される）。呼び出し元（入力のたびと
    // ResizeObserver）の両方から同じ関数を呼び直すことで、常に今のフレームに対して
    // 正しい位置に揃える。
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
    //
    // 幅は、確定時の折り返し幅と同じ「書き込み領域の右端まで」。高さだけ内容に
    // 応じて伸びる。ソフトキーボードで見えている範囲（visual viewport）が縮んだ
    // ときは、その中に収まるようクランプする。
    const resizeToContent = () => {
      const canvasRect = this.canvas.getBoundingClientRect();
      const scale = this.effectiveScale();
      const vv = window.visualViewport;
      const viewportOffsetX = vv?.offsetLeft ?? 0;
      const viewportOffsetY = vv?.offsetTop ?? 0;
      const lineMargin = 8;
      const visW = vv?.width ?? window.innerWidth;
      const visH = vv?.height ?? window.innerHeight;
      const wrapScreenPx = Math.max(
        (minLineWrapWidthPx(fontSize) / REFERENCE_RADIUS) * scale,
        (this.lineTextArea().right - lineLeft) * scale
      );
      const widthScreenPx = Math.min(wrapScreenPx, visW - lineMargin * 2);
      el.style.width = `${widthScreenPx / lineScaleK}px`;
      el.style.height = "auto";
      const contentH = el.scrollHeight;
      const toolbarH = toolbarEl ? toolbarEl.offsetHeight : 0;
      const maxVisualH = Math.max(fontPx * lineHeight, visH - toolbarH - lineMargin * 2);
      const clampedContentH = Math.min(contentH, maxVisualH / lineScaleK);
      el.style.height = `${clampedContentH}px`;
      el.style.overflowY = contentH > clampedContentH + 1 ? "auto" : "hidden";
      const visualH = clampedContentH * lineScaleK;
      const lineScreenX = canvasRect.left + this.frame.centerPx.x + this.viewPan.x + lineLeft * scale + viewportOffsetX;
      const lineScreenY = canvasRect.top + this.frame.centerPx.y + this.viewPan.y + lineTop * scale + viewportOffsetY;
      const lMin = viewportOffsetX + lineMargin;
      const lMax = viewportOffsetX + visW - widthScreenPx - lineMargin;
      const tMin = viewportOffsetY + lineMargin;
      const tMax = viewportOffsetY + visH - toolbarH - visualH - lineMargin;
      if (toolbarEl) {
        toolbarEl.style.left = `${viewportOffsetX}px`;
        toolbarEl.style.width = `${visW}px`;
        toolbarEl.style.top = `${viewportOffsetY + visH - toolbarH}px`;
      }
      el.style.transformOrigin = "0 0";
      el.style.transform = lineScaleK < 1 ? `scale(${lineScaleK})` : "";
      el.style.left = `${lMax >= lMin ? Math.min(Math.max(lineScreenX, lMin), lMax) : lMin}px`;
      el.style.top = `${tMax >= tMin ? Math.min(Math.max(lineScreenY, tMin), tMax) : tMin}px`;
    };
    resizeToContent();
    el.addEventListener("input", resizeToContent);
    // 行頭の「- 」「* 」を打った直後に「・ 」へ変換する（IME変換中の
    // スペースはinsertCompositionTextなので対象外）。
    el.addEventListener("input", (iev) => {
      if (applyingEdit) return;
      const ie = iev as InputEvent;
      if (ie.inputType !== "insertText" || ie.data !== " ") return;
      const converted = autoConvertBullet(readState());
      if (converted) applyEdit(converted);
    });
    this.repositionTextEditor = resizeToContent;
    this.applyEditingTextColor = (nextColor: string) => {
      if (this.textEditor !== el) return;
      if (
        isAppendingToFlow &&
        currentEditingMemo &&
        nextColor !== currentEditingMemo.color &&
        el.value.startsWith(`${currentEditingMemo.text}\n`)
      ) {
        const added = el.value.slice(currentEditingMemo.text.length + 1);
        const prevOff = this.memoDisplayOffset(currentEditingMemo);
        const prevBottom = currentEditingMemo.y + prevOff.y + currentEditingMemo.boxHeight / 2;
        lineTop = snapToRowTop(prevBottom + rowPitch * 0.25, rowPitch);
        currentEditingMemo = null;
        this.editingMemoId = null;
        color = nextColor;
        el.style.color = resolveInkColor(color);
        el.value = added;
        el.setSelectionRange(el.value.length, el.value.length);
        resizeToContent();
        this.render();
        return;
      }
      color = nextColor;
      el.style.color = resolveInkColor(color);
      this.render();
    };
    // 開いた時点でまだ読み込み中のWebフォント（Klee One/Noto Sans JP）があると、
    // 高さの計測がフォールバックフォントの字幅で行われてしまう。フォント読み込み完了を
    // 待って、開いていればもう一度測り直す——読み込み済みなら即座に解決する。
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

    const commit = () => {
      if (this.textEditor !== el) return; // すでに片付け済みなら何もしない
      this.textEditor = null;
      this.editingMemoId = null;
      this.repositionTextEditor = null;
      this.applyEditingTextColor = null;
      this.restoreBodyScroll?.();
      // 先頭行のインデント（全角スペース）を残したいので、先頭の空行と、末尾の空行・
      // 記号だけの行（書きかけの空の項目）だけを取り除く。
      const value = stripTrailingBlankLines(el.value.replace(/^(?:[ \t　]*\n)+/, "")).trimEnd();
      el.remove();
      this.textEditorToolbar?.remove();
      this.textEditorToolbar = null;
      if (!value || isBlankText(value)) {
        if (currentEditingMemo) {
          this.ensureUndoSnapshot();
          this.store.deleteMemo(currentEditingMemo.id);
          this.reflowLineMemos();
        }
        return;
      }

      // 左端・上端を固定し、書き込み領域の右端までで折り返す。メモの中心は
      // 確定した幅・高さから逆算する（左揃えで描くため、左端 = x − boxWidth/2）。
      const area = this.lineTextArea();
      const wrapRefPx = Math.max(minLineWrapWidthPx(fontSize), (area.right - lineLeft) * REFERENCE_RADIUS);
      const { lines, contentWidthPx } = layoutText(this.ctx, value, fontSize, wrapRefPx);
      const { width, height } = normalizedBoxSize(
        fontSize,
        lines.length,
        Math.max(contentWidthPx, fontSize * 2), // 当たり判定が極端に細くならないよう最低幅を持たせる
        lineHeight
      );
      const top = lineTop;
      const position = { x: lineLeft + width / 2, y: top + height / 2 };
      // 続きを書き始めただけで何も足さず色も変えなかった場合は、何も変更しない。
      if (currentEditingMemo && value === currentEditingMemo.text && color === currentEditingMemo.color) return;
      this.ensureUndoSnapshot();
      if (currentEditingMemo) {
        const offset = this.memoDisplayOffset(currentEditingMemo);
        this.store.materializeDisplayOffset(currentEditingMemo.id, offset.x, offset.y, this.frame.usableHalfExtents());
        this.store.updateTextMemo(currentEditingMemo.id, value, lines, width, height, {
          position,
          color,
          layout: "line",
          align: "left",
        });
      } else {
        this.store.createTextMemo(
          position,
          value,
          lines,
          fontSize,
          width,
          height,
          { color, align: "left", lineHeight, layout: "line" },
          Date.now(),
          this.frame.usableHalfExtents()
        );
      }
      this.reflowLineMemos();
    };
    el.addEventListener("blur", commit);
    el.addEventListener("keydown", (kev) => {
      // 日本語IMEで変換候補を選んでいる最中のEscapeは「変換候補を閉じる」ためのキー入力であり、
      // 入力全体の取り消しではない。isComposingを見ずに反応すると、変換候補を1つ閉じたいだけ
      // なのに入力していた文字ごと消えてしまうバグになるため、IME変換中は無視する。
      // Escapeは確定（長く書いた文章を誤って失わないため、取り消しにはしない）。
      if (kev.key === "Escape" && !kev.isComposing && !composing) {
        // このEscapeは入力の確定だけに使う。伝播させると、main.tsのEscapeでの道具の解除まで
        // 同じ1回の押下で働いてしまう（道具の解除は、次にもう一度押したとき）。
        kev.stopPropagation();
        el.blur();
        return;
      }
      // EnterはShift+Enterと同じ改行（一気に続けて書けるように。確定はEscape・外タップ・
      // モバイルの✓）。IME変換中・変換確定直後のEnterは、改行ではなく変換の確定なので
      // 何もしない（上記コメント参照）。
      const justFinishedComposing = performance.now() - lastCompositionEndAt < COMPOSITION_GRACE_MS;
      const imeBusy = kev.isComposing || composing || kev.keyCode === 229;
      // リスト操作：Tab/Shift+Tabでインデント、記号の直後のBackspaceで記号を外す。
      if (!imeBusy) {
        if (kev.key === "Tab") {
          kev.preventDefault(); // フォーカスが外れて確定されてしまうのを防ぐ
          applyEdit(kev.shiftKey ? outdentLines(readState()) : indentLines(readState()));
          return;
        }
        if (kev.key === "Backspace") {
          const next = backspaceAtMarker(readState());
          if (next) {
            kev.preventDefault();
            applyEdit(next);
            return;
          }
        }
      }
      if (kev.key === "Enter") {
        if (justFinishedComposing) {
          kev.preventDefault(); // 変換確定のEnterが改行として入ってしまうのを防ぐ
          return;
        }
        if (imeBusy) return;
        // リストの行なら次の項目の記号を自動で入れる。リストでなければ<textarea>
        // 既定の改行に任せる。
        const next = continueList(readState());
        if (next) {
          kev.preventDefault();
          applyEdit(next);
        }
      }
    });
  }

  /** モバイルの行モード編集中にキーボード直上へ出す、アイコンだけのツールバー。
   *  ボタンのpointerdown/mousedownでpreventDefaultして、タップしてもtextareaから
   *  フォーカスが外れない（＝blurで確定されない）ようにする。 */
  private buildTextEditorToolbar(actions: {
    bullet: () => void;
    number: () => void;
    indent: () => void;
    outdent: () => void;
    done: () => void;
  }): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "text-editor-toolbar";
    const svg = (d: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const buttons: { label: string; html: string; run: () => void; cls?: string }[] = [
      { label: "箇条書き", html: "・", run: actions.bullet },
      { label: "番号付きリスト", html: "1.", run: actions.number },
      { label: "インデントを増やす", html: svg('<path d="M4 6h16M12 12h8M4 18h16M4 9l4 3-4 3"/>'), run: actions.indent },
      { label: "インデントを減らす", html: svg('<path d="M4 6h16M12 12h8M4 18h16M8 9l-4 3 4 3"/>'), run: actions.outdent },
      { label: "確定", html: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), run: actions.done, cls: "text-editor-toolbar-btn--done" },
    ];
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = b.cls ? `text-editor-toolbar-btn ${b.cls}` : "text-editor-toolbar-btn";
      btn.setAttribute("aria-label", b.label);
      btn.innerHTML = b.html;
      const keepFocus = (ev: Event) => ev.preventDefault();
      btn.addEventListener("pointerdown", keepFocus);
      btn.addEventListener("mousedown", keepFocus);
      btn.addEventListener("click", b.run);
      bar.appendChild(btn);
    }
    return bar;
  }

  /** 編集中のテキストがあれば確定する（画面切り替え・道具切り替え時に呼ぶ）。 */
  finishTextEditingIfOpen(): void {
    this.textEditor?.blur();
  }

  /** テキスト編集中に色スワッチが押されたとき、入力欄を閉じずに色を反映する。 */
  setEditingTextColor(nextColor: string): void {
    this.applyEditingTextColor?.(nextColor);
  }

  /** 道具バーの「戻る」ボタン（issue #90）用。道具を問わず使える。
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

  /** 道具バーの「やり直す」ボタン用。undo()と同じ理由で書き込みセッションを打ち切る。 */
  redo(): void {
    this.store.redo();
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

    if (this.lineDrag) {
      this.updateLineDrag(p);
    } else if (this.state.mode === "drawing" && this.state.activeMemoId) {
      this.store.addPointToLastStroke(this.state.activeMemoId, p);
    } else if (this.state.mode === "moving" && this.state.movingMemoId && this.state.lastPoint) {
      const dx = p.x - this.state.lastPoint.x;
      const dy = p.y - this.state.lastPoint.y;
      if (dx !== 0 || dy !== 0) {
        if (!this.undoSnapshotTaken) {
          this.ensureUndoSnapshot();
          const movingMemo = this.store.getActive().find((m) => m.id === this.state.movingMemoId);
          if (movingMemo) {
            const offset = this.memoDisplayOffset(movingMemo);
            this.store.materializeDisplayOffset(movingMemo.id, offset.x, offset.y, this.frame.usableHalfExtents());
          }
        }
        this.store.translateMemo(this.state.movingMemoId, dx, dy, this.inputClamp());
        this.state.lastPoint = p;
      }
    } else if (this.state.mode === "erasing") {
      this.eraseAtPoint(p);
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
    if (this.locked) return;
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
    this.onAutoTextToolStart?.();
    this.openTextAtFlowEnd(ev.key);
  };

  /** フィット(1倍)より拡大しているか。main.tsがヘッダー/ツールバー（画面全体に
   *  広がったキャンバスの上に固定オーバーレイとして乗る）を薄くするかどうかの
   *  判定に使う（ユーザー指示：ズーム中は下の絵が見えるよう薄くしたい）。 */
  isZoomed(): boolean {
    return this.viewZoom > MIN_ZOOM;
  }

  private renderBackgroundTimer(
    ctx: CanvasRenderingContext2D,
    r: number,
    dark: boolean,
    isEmpty: boolean,
    timerText: string
  ): void {
    const now = performance.now();
    const targetAlpha = isEmpty ? (dark ? 0.28 : 0.24) : dark ? 0.14 : 0.12;
    if (this.timerDisplayAlpha === null) {
      this.timerDisplayAlpha = targetAlpha;
    } else {
      this.timerDisplayAlpha += (targetAlpha - this.timerDisplayAlpha) * 0.14;
      if (Math.abs(targetAlpha - this.timerDisplayAlpha) < 0.001) {
        this.timerDisplayAlpha = targetAlpha;
      }
    }
    const baseAlpha = this.timerDisplayAlpha;

    if (this.prevTimerText !== null && this.prevTimerText !== timerText && this.prevTimerText.length === timerText.length) {
      // "HH:MM:SS" の辞書順比較で、時間が増えている（08:00:00へ巻き戻っている）か減っているかを判定
      const isRewind = timerText > this.prevTimerText;
      const direction: 1 | -1 = isRewind ? 1 : -1;
      const durationMs = isRewind ? 340 : 240;

      while (this.timerSlotAnims.length < timerText.length) {
        this.timerSlotAnims.push(null);
      }

      for (let i = 0; i < timerText.length; i++) {
        if (this.prevTimerText[i] !== timerText[i]) {
          const existing = this.timerSlotAnims[i];
          // 高速巻き戻し中で直前にも同じ桁が変化していた場合は、ロール途中の位相を保って連続回転に見せる
          const isRapidSpin = existing !== null && existing !== undefined && now - existing.startTime < 90;
          this.timerSlotAnims[i] = {
            fromChar: this.prevTimerText[i],
            toChar: timerText[i],
            startTime: isRapidSpin ? now - 75 : now - 16,
            durationMs,
            direction,
          };
        }
      }
    }
    this.prevTimerText = timerText;

    ctx.save();
    const timerFontPx = Math.max(22, Math.round(r * 0.105));
    ctx.font = `300 ${timerFontPx}px "Cormorant Garamond", "Times New Roman", Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const digitW = ctx.measureText("0").width;
    const colonW = ctx.measureText(":").width;
    const gap = timerFontPx * 0.06;
    const widths = Array.from(timerText, (ch) => (ch === ":" ? colonW : digitW));
    const totalW = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
    const slideDist = timerFontPx * 0.52;
    const colorPrefix = dark ? "oklch(92% 0.006 75 / " : "oklch(22% 0.012 55 / ";

    let x = -totalW / 2;
    for (let i = 0; i < timerText.length; i++) {
      const cx = x + widths[i] / 2;
      x += widths[i] + gap;
      const anim = this.timerSlotAnims[i];
      if (anim) {
        const rawT = Math.min(1, Math.max(0, (now - anim.startTime) / anim.durationMs));
        if (rawT >= 1) {
          this.timerSlotAnims[i] = null;
          ctx.fillStyle = `${colorPrefix}${baseAlpha})`;
          ctx.fillText(timerText[i], cx, 0);
        } else {
          const e = 1 - Math.pow(1 - rawT, 3);
          const oldAlpha = baseAlpha * (1 - e);
          const newAlpha = baseAlpha * e;
          const oldY = anim.direction * e * slideDist;
          const newY = -anim.direction * (1 - e) * slideDist;
          ctx.fillStyle = `${colorPrefix}${oldAlpha})`;
          ctx.fillText(anim.fromChar, cx, oldY);
          ctx.fillStyle = `${colorPrefix}${newAlpha})`;
          ctx.fillText(anim.toChar, cx, newY);
        }
      } else {
        ctx.fillStyle = `${colorPrefix}${baseAlpha})`;
        ctx.fillText(timerText[i], cx, 0);
      }
    }
    ctx.restore();
  }

  render(): void {
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    if (this.locked || (this.state.mode === "idle" && !this.pointerInsideFrame)) {
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
            : tool === "none"
              ? "default"
              : "crosshair";
    }
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w / this.dpr, h / this.dpr);

    const activeMemos = this.store.getActive();
    this.frame.syncScaleForMemos(activeMemos);
    const r = this.frame.scale;
    const dark = isDarkThemeActive();

    ctx.translate(this.frame.centerPx.x + this.viewPan.x, this.frame.centerPx.y + this.viewPan.y);
    // ピンチズームの倍率をここで1回だけ適用する。以降の描画（メモのストローク・
    // 罫線紙・グロー・消しゴムカーソル等）はすべてこのtransformの上に乗るため、
    // 個々の描画コードは一切変更不要で自動的にズームが反映される。
    ctx.scale(this.viewZoom, this.viewZoom);

    const fillHalfW = (this.frame.width / 2 + Math.abs(this.viewPan.x)) / this.viewZoom;
    const fillHalfH = (this.frame.height / 2 + Math.abs(this.viewPan.y)) / this.viewZoom;
    drawRuledPaper(ctx, r, fillHalfW, fillHalfH);

    const timerText = this.getBackgroundTimerText?.();
    if (timerText) {
      this.renderBackgroundTimer(ctx, r, dark, activeMemos.length === 0, timerText);
    }

    for (const memo of activeMemos) {
      if (memo.id === this.editingMemoId) continue; // 編集中はtextareaが代わりに表示する
      const offset = this.memoDisplayOffset(memo);
      if (offset.x !== 0 || offset.y !== 0) {
        ctx.save();
        ctx.translate(offset.x * r, offset.y * r);
        renderMemoAt(ctx, memo, r, 1);
        ctx.restore();
      } else {
        renderMemoAt(ctx, memo, r, 1);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";

    this.renderLineDrag(ctx, r, dark);

    if (this.state.mode === "moving" && this.state.lastPoint) {
      drawRadialGlow(
        ctx,
        this.state.lastPoint.x * r,
        this.state.lastPoint.y * r,
        22,
        dark ? TRACE_GLOW_DARK : TRACE_GLOW
      );
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
      ctx.strokeStyle = dark ? ERASER_CURSOR_DARK : ERASER_CURSOR;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    ctx.restore(); // translate + setTransform
  }

  /** このインスタンスを使い終えたら呼ぶ。ResizeObserverと`window`に登録した
   *  ポインタリスナーを解除する。 */
  destroy(): void {
    this.resizeObserver.disconnect();
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
    this.textEditor?.remove();
    this.textEditorToolbar?.remove();
    this.restoreBodyScroll?.();
    this.canvas.remove();
  }
}
