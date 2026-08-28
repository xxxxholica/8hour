import {
  computeAutoScale,
  computeChromeCenterOffsetY,
  computeContainerSize,
  computeRectSize,
  computeSquareSize,
  fitCanvasToContainer,
} from "./canvasSizing";
import {
  FRAME_SHAPE_ORDER,
  getFrameShape,
  getGlassesFrameShape,
  glassesBridgeHalfWidth,
  GLASSES_HINGE_TAB_HALF_HEIGHT,
  GLASSES_HINGE_TAB_LENGTH,
  GLASSES_HINGE_TAB_RADIUS,
  GLASSES_HORIZONTAL_REACH_WITH_HINGE,
  GLASSES_VERTICAL_REACH,
} from "./frameShape";
import type { FrameShape, FrameShapeId } from "./frameShape";
import { FRAME_PATTERN_ORDER, getFramePattern } from "./framePattern";
import type { FramePatternId } from "./framePattern";
import { chooseLensSplitDirection, computeLensPairCenters } from "./lensSplit";
import { isDarkThemeActive } from "./theme";
import type { Point } from "./types";

/** 片眼鏡（frameKind==="monocle"、実験中）のチェーンの見た目。ヒンジタブ
 *  （drawHingeTabs、frameShape.tsのGLASSES_HINGE_TAB_*）の下端から垂らす
 *  ——タブ自体は残したまま、そこからチェーンを伸ばすイメージ（ユーザー指示）。
 *  真下へ直線に9輪連ねる（ユーザー指示：一本の紐・紡錘形の帯も試したが、
 *  最初の丸型の連なりに戻したいとのことで復帰）。scale基準（正規化単位）の
 *  値——drawMonocleChain参照。 */
const MONOCLE_CHAIN_LINK_COUNT = 9;
const MONOCLE_CHAIN_LINK_RADIUS = 0.045;
const MONOCLE_CHAIN_LINK_SPACING = 0.09;
const MONOCLE_CHAIN_LINE_WIDTH = 0.018;
/** フレームの柄・質感（"フレームなし"だと紙と同じ白）から独立した固定色。
 *  普段は元のインク色のまま——ダークテーマ（isDarkThemeActive()）の時だけ
 *  暗い紙の背景に同化して見えづらくなる（ユーザー報告）ため、その時だけ
 *  シルバーがかったグレーに差し替える（ユーザー指示：黒色の時だけ紐の色を
 *  変えたい）。シルバー側は輪の左右で明暗を作るグラデーション（暗→明るい
 *  ハイライト→中間→暗）をstrokeStyleに使い、金属の丸線に光が当たって
 *  反射しているような見た目にする（drawMonocleChain参照、ユーザー指示：
 *  光沢感を足したい）。一度ワントーン暗く重み寄りの配色にしたが、重厚感が
 *  出過ぎたため（ユーザー指示：重厚感をなくしたい）明るいシルバーに戻した上で、
 *  暗→明のコントラスト（特にハイライトの明るさ）だけを少し抑え、明るいトーンは
 *  保ったまま光沢を弱めた（ユーザー指示：光沢感をもう少し減らしたい）。 */
const MONOCLE_CHAIN_INK_COLOR = "oklch(35% 0.02 55)";
const MONOCLE_CHAIN_SHADOW_COLOR = "oklch(50% 0.015 250)";
const MONOCLE_CHAIN_HIGHLIGHT_COLOR = "oklch(87% 0.005 250)";
const MONOCLE_CHAIN_BASE_COLOR = "oklch(74% 0.01 250)";

interface FrameGeometryOptions {
  frameShapeId: FrameShapeId;
  frameStrokeWidth: number | ((canvasSizePx: number) => number);
  frameKind: "single" | "glasses" | "monocle";
  framePatternId: FramePatternId;
  contentScaleFactor?: number | ((size: number) => number);
  /** computeSquareSizeの下限をMIN_CANVAS_SIZE(200px)から差し替える。
   *  CircularCanvasOptions.minCanvasSizePx参照。 */
  minCanvasSizePx?: number;
}

/**
 * `CircularCanvas`（canvasView.ts）からフレーム形状・サイズ計算・縁取りの
 * 描画に関わる状態をひとまとめにしたもの（canvasView.tsが1000行超まで肥大化
 * したための整理、Refactor）。`canvas`/`ctx`/`container`/`dpr`は他の関心事
 * （ポインタ操作・テキスト編集・テンプレート配置など）からも広く参照される
 * 共有インフラのため、ここには持たせず参照として受け取るだけにする——
 * `CircularCanvas`が引き続き所有する。
 *
 * メモの座標は「円の半径を1とする正規化座標」で保存する（中心が原点、
 * 円周上が距離1）。こうしておくとウィンドウサイズが変わって円の物理的な
 * 大きさ（px）が変化しても、既存のメモが縮んで見えたり位置がずれたりしない
 * ——ウィンドウを広げれば単純にその分だけ拡大して描かれる。
 */
export class FrameGeometry {
  private scaleValue = 0;
  private centerPxValue: Point = { x: 0, y: 0 };
  private contentScaleFactor: number | ((size: number) => number) | undefined;
  private frameShapeIdValue: FrameShapeId;
  private frameStrokeWidthOption: number | ((canvasSizePx: number) => number);
  /** 実際に使う縁取りの太さ（px）。frameStrokeWidthOptionが関数の場合、
   *  resize()のたびにその時のキャンバス実サイズで解決し直す。 */
  private frameStrokeWidthValue = 1;
  private frameKindValue: "single" | "glasses" | "monocle";
  private framePatternId: FramePatternId;
  private minCanvasSizePx: number | undefined;
  /** クリップ・外枠描画に使うPath2D。scale/frameShapeId/frameStrokeWidthが変わる
   *  resize()/setFrameShape()のタイミングでだけ組み立て直し、render()（毎フレーム）
   *  では使い回す——Path2Dの構築自体は軽くないため。 */
  private framePathValue: Path2D = new Path2D();
  private strokePathValue: Path2D = new Path2D();
  /** 枠のctx.strokeStyle/fillStyleに使う値。frameKindに関わらずframePatternId
   *  から組み立てる。rebuildFramePaths()と同じタイミングで組み立て直す。 */
  private frameStyleValue: CanvasPattern | CanvasGradient | string = "";
  /** ブリッジ（接合部）の半分の高さ（scale基準、正規化単位）。frameKind==="glasses"
   *  の時だけ意味を持つ——「接合部をフレームと同じ太さにする」（ユーザー指示）ため、
   *  frameStrokeWidth（px）をその時のscaleで正規化単位に変換した値。
   *  rebuildFramePaths()で組み立て直す。 */
  private glassesBridgeHalfHeight = 0;
  /** レンズ分割表示(共同アイデア出しフェーズ①、issue #79)が有効な間の組数。
   *  無効時はnull。有効な間、resize()はGLASSES_HORIZONTAL_REACH_WITH_HINGE/
   *  GLASSES_VERTICAL_REACH基準の単一ペアではなく、lensSplitPairCentersValueの
   *  この数ぶんを内包するサイズで計算する。framePath/strokePathは変更しない
   *  （1組ぶんのローカル原点基準のPath2Dのまま）——複数組化はcanvasView.ts側の
   *  描画ループで平行移動して使い回す。 */
  private lensSplitPairCountValue: number | null = null;
  /** レンズ分割時の各組の中心座標（正規化単位）。無効時はnull。 */
  private lensSplitPairCentersValue: Point[] | null = null;
  /** レンズ分割時、組ごとに柄を変えるための組別スタイル一覧(index=pairIndex)。
   *  全部同じ柄が並ぶと見分けが付きにくく単調に見える(issue #79、ユーザー指摘)
   *  ため、設定された柄を起点にFRAME_PATTERN_ORDERを順送りする。無効時は空配列
   *  ——frameStyleForPair()がframeStyleValueにフォールバックする。 */
  private pairFrameStyles: (CanvasPattern | CanvasGradient | string)[] = [];
  /** pairFrameStylesに対応する柄ID一覧(index=pairIndex)。framePatternIdForPair
   *  (issue #113④、UI表示用)のために、描画用スタイル(pairFrameStyles)とは
   *  別にIDそのものも保持しておく。 */
  private pairFramePatternIds: FramePatternId[] = [];
  /** レンズ分割時、組ごとに形状(丸眼鏡/楕円/長方形)を変えるための組別形状ID一覧
   *  (index=pairIndex)。柄と同様、同じ形状が並び続けると見分けが付きにくいため
   *  (issue #113③、ユーザー要望)、設定された形状を起点にFRAME_SHAPE_ORDERを
   *  順送りする。無効時は空配列——frameShapeIdForPair()がframeShapeIdValueへ
   *  フォールバックする。 */
  private pairFrameShapeIds: FrameShapeId[] = [];
  /** pairFrameShapeIdsに対応する、組ごとのframePath/strokePath。組ごとに形状
   *  そのものが異なるため、柄(frameStyleForPair)と違い単一のPath2Dを使い回せず
   *  組ごとに個別のPath2Dを持つ必要がある。 */
  private pairFramePaths: Path2D[] = [];
  private pairStrokePaths: Path2D[] = [];
  /** 「メガネ2」組(pairIndex=1)専用の見た目の手動上書き(issue #113④、編集可能な
   *  全ユーザーが個別に設定できる)。どちらもnullの間はbuildPairFrameShapeIds/
   *  buildPairFrameStylesの自動ローテーション(issue #113③)にフォールバックする。
   *  「メガネ1」(pairIndex=0)はframeShapeIdValue/framePatternId自体が基準値
   *  ——上書きという概念が無く、setFrameShape/setFramePatternをそのまま使う。 */
  private pair2ShapeOverride: FrameShapeId | null = null;
  private pair2PatternOverride: FramePatternId | null = null;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private dpr: number;

  constructor(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    container: HTMLElement,
    dpr: number,
    options: FrameGeometryOptions
  ) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.container = container;
    this.dpr = dpr;
    this.frameShapeIdValue = options.frameShapeId;
    this.frameStrokeWidthOption = options.frameStrokeWidth;
    this.frameKindValue = options.frameKind;
    this.framePatternId = options.framePatternId;
    this.contentScaleFactor = options.contentScaleFactor;
    this.minCanvasSizePx = options.minCanvasSizePx;
    this.resize();
  }

  get scale(): number {
    return this.scaleValue;
  }

  get frameStrokeWidthPx(): number {
    return this.frameStrokeWidthValue;
  }

  get centerPx(): Point {
    return this.centerPxValue;
  }

  get framePath(): Path2D {
    return this.framePathValue;
  }

  get strokePath(): Path2D {
    return this.strokePathValue;
  }

  get frameStyle(): CanvasPattern | CanvasGradient | string {
    return this.frameStyleValue;
  }

  /** レンズ分割時、指定した組(pairIndex)に使う柄のスタイル。組別のスタイルが
   *  無ければ(無効時・範囲外)通常のframeStyleにフォールバックする。 */
  frameStyleForPair(pairIndex: number): CanvasPattern | CanvasGradient | string {
    return this.pairFrameStyles[pairIndex] ?? this.frameStyleValue;
  }

  /** レンズ分割時、指定した組(pairIndex)に使う形状ID。組別の形状が無ければ
   *  (無効時・範囲外)通常のframeShapeIdにフォールバックする。 */
  frameShapeIdForPair(pairIndex: number): FrameShapeId {
    return this.pairFrameShapeIds[pairIndex] ?? this.frameShapeIdValue;
  }

  /** レンズ分割時、指定した組(pairIndex)に使う柄ID。frameShapeIdForPairの柄版。
   *  AppearanceSelector側(issue #113④、メガネ1/メガネ2の個別調整UI)が「今の
   *  組にはどの柄ボタンをアクティブ表示すべきか」を知るために使う——
   *  frameStyleForPairはCanvas描画用のスタイル値(色・パターン)であってIDでは
   *  ないため、これとは別に持つ。 */
  framePatternIdForPair(pairIndex: number): FramePatternId {
    return this.pairFramePatternIds[pairIndex] ?? this.framePatternId;
  }

  /** レンズ分割時、指定した組(pairIndex)に使う形状(FrameShape、眼鏡形状ファミリー)。
   *  frameShapeIdForPairのFrameShape版——ヒンジ描画(drawGlassesHinges)・
   *  プレースホルダーの塗り範囲(maxReach)にはid単体ではなくFrameShapeそのもの
   *  が要る。 */
  frameShapeForPair(pairIndex: number): FrameShape {
    return getGlassesFrameShape(this.frameShapeIdForPair(pairIndex));
  }

  /** レンズ分割時、指定した組(pairIndex)専用のframePath。組ごとに形状が異なる
   *  ため単一のframePathを使い回せない——無ければ(無効時・範囲外)通常の
   *  framePathにフォールバックする。 */
  framePathForPair(pairIndex: number): Path2D {
    return this.pairFramePaths[pairIndex] ?? this.framePathValue;
  }

  /** framePathForPairのstrokePath版。 */
  strokePathForPair(pairIndex: number): Path2D {
    return this.pairStrokePaths[pairIndex] ?? this.strokePathValue;
  }

  get frameKind(): "single" | "glasses" | "monocle" {
    return this.frameKindValue;
  }

  get frameShapeId(): FrameShapeId {
    return this.frameShapeIdValue;
  }

  /** レンズ分割表示時の3組の中心座標（正規化単位）。無効時はnull。 */
  get lensSplitPairCenters(): Point[] | null {
    return this.lensSplitPairCentersValue;
  }

  /** 今のframeKindに応じたフレーム形状を返す（"glasses"なら眼鏡形状ファミリー、
   *  "single"なら従来通りの単一形状）。 */
  currentShape(): FrameShape {
    return this.frameKindValue === "glasses"
      ? getGlassesFrameShape(this.frameShapeIdValue)
      : getFrameShape(this.frameShapeIdValue);
  }

  /** レンズ分割表示(共同アイデア出しフェーズ①)のON/OFF・組数を切り替える。
   *  null=無効、数値=その組数で有効。変化があれば次のresize()でサイズ・
   *  lensSplitPairCentersを再計算する。 */
  setLensSplitPairCount(pairCount: number | null): void {
    if (this.lensSplitPairCountValue === pairCount) return;
    this.lensSplitPairCountValue = pairCount;
    this.resize();
  }

  /** 「メガネ2」組(pairIndex=1)の見た目を手動で上書きする(issue #113④)。
   *  両方nullに戻すと自動ローテーション(issue #113③)に戻る。 */
  setPair2Appearance(shapeId: FrameShapeId | null, patternId: FramePatternId | null): void {
    if (this.pair2ShapeOverride === shapeId && this.pair2PatternOverride === patternId) return;
    this.pair2ShapeOverride = shapeId;
    this.pair2PatternOverride = patternId;
    this.resize();
  }

  /** キャンバス要素自体は、利用可能な幅・高さいっぱいの矩形として広げる
   *  （frameKind==="single"）。フレーム（円/楕円/長方形）の描画基準サイズは
   *  これとは別に、利用可能な幅・高さのうち小さい方（上下限だけ設ける）を
   *  そのまま使う——キャンバス領域を画面いっぱいに広げても、フレームの見た目の
   *  大きさ自体は変えないため（issue #83、ユーザー指示）。frameKind==="glasses"の
   *  場合は、正方形ではなくGLASSES_HORIZONTAL_REACH_WITH_HINGE/GLASSES_VERTICAL_REACH比の
   *  横長矩形として広げる——縦横で必要な余白（縁取り・ヒンジぶん）が異なるため、軸ごとに
   *  computeAutoScaleした小さい方をscaleとして採用する。
   *
   *  中心（centerPxValue）はキャンバス要素の幾何中心からcomputeChromeCenterOffsetY()
   *  ぶんだけ上へ補正する——ヘッダー・フッターは画面の真の上端／下端に固定表示
   *  される半透明の帯で、キャンバス要素自体はその下まで含めて画面いっぱいに
   *  広がるため、補正しないとフッター（ヘッダーより背が高い）側へ円が寄って
   *  見えてしまう（ユーザー指摘）。 */
  resize(): void {
    // #app（style.css）はmin-height:100dvhで最低限のみ保証しており、キャンバスの
    // 実サイズ（style幅高さ）自体もその祖先の「中身から決まる高さ」に数えられる
    // ——一度大きく広がった状態のまま次のresize()の計測(getBoundingClientRect)に
    // 入ると、祖先がその大きさに広がったままなのを「利用可能な広さ」として読み取り、
    // 同じ大きさを出し直してしまう（画面を拡大してから縮小しても縮んだ大きさに
    // 戻らない自己参照ループ、ユーザー報告のバグ）。計測の直前に自分自身を一旦
    // 0にして祖先への影響を切ってから測ることで、祖先が実際に縮んだ後の
    // 正しい大きさを読み取れるようにする。
    this.canvas.style.width = "0px";
    this.canvas.style.height = "0px";
    if (this.frameKindValue === "glasses") {
      // ヒンジの鋲がキャンバス要素の外にクリップされないよう、横方向の余白は
      // GLASSES_HORIZONTAL_REACH_WITH_HINGE（鋲ぶんを含む）を基準にする。
      // referenceWidth/Heightはフレーム（眼鏡）の描画基準サイズ専用——
      // キャンバス要素自体はこれとは別にcomputeContainerSize（コンテナいっぱい）
      // を使う。眼鏡は横長のアスペクト比固定のため、縦長スマホでは常に幅で
      // 頭打ちになり、以前はそれがそのままキャンバス要素の高さにもなっていた。
      // "single"と同様に画面全体まで広げるようにした結果、コンテナ（.smui-canvas-wrap）
      // は画面全体に育つのに、実際の<canvas>要素は幅基準の低い高さのまま――という
      // ズレが生まれ、ズーム・パンしてもその低い高さの外（画面の上下）には
      // 絶対に届かなくなっていた（ユーザー指摘・実機確認済み）。
      // レンズ分割表示(issue #79)が有効なら、その組数ぶんの中心座標を画面の
      // 縦横比から計算し、それら全てを内包するサイズを基準にする——無効時は
      // pairCentersが原点1点だけの配列になり、outerX/outerYはGLASSES_HORIZONTAL_
      // REACH_WITH_HINGE/GLASSES_VERTICAL_REACHと完全に一致する（既存の単一ペア
      // 計算と同じ結果になり、回帰が無いようにする）。
      const containerRect = this.container.getBoundingClientRect();
      const pairCenters =
        this.lensSplitPairCountValue !== null
          ? computeLensPairCenters(
              chooseLensSplitDirection(containerRect.width, containerRect.height),
              this.lensSplitPairCountValue
            )
          : [{ x: 0, y: 0 }];
      const outerX = Math.max(...pairCenters.map((c) => Math.abs(c.x))) + GLASSES_HORIZONTAL_REACH_WITH_HINGE;
      const outerY = Math.max(...pairCenters.map((c) => Math.abs(c.y))) + GLASSES_VERTICAL_REACH;
      const containerSize = computeContainerSize(this.container, this.minCanvasSizePx);
      // frameStrokeWidthが関数の場合、ここで確定した高さ（横長なので制約になり
      // やすい辺）を基準に解決する——スケール（scale）自体はこの後で初めて決まるため、
      // scaleではなくwidth/heightという「確定済みの実寸」を基準にする。ただし
      // singlePairReferenceHeightそのものは、レンズ分割(issue #79)で複数組を並べた
      // 全体ではなく「組数1（通常時）としての基準サイズ」を使う——複数組ぶんの
      // 全体サイズを基準にすると、参加人数が増えるだけで個々のフレームの縁取りが
      // 太く＝大きく見える不具合があった（issue #113②、ユーザー報告）。縁取りの太さは
      // 常にこの「組数1」基準で決め、複数組を並べる分の拡張は下のscale計算だけに
      // 反映させることで、個々のフレームの大きさを参加人数に依らず一定に保つ。
      const singlePairAspectRatio = GLASSES_HORIZONTAL_REACH_WITH_HINGE / GLASSES_VERTICAL_REACH;
      const { width: singlePairReferenceWidth, height: singlePairReferenceHeight } = computeRectSize(
        this.container,
        singlePairAspectRatio
      );
      this.frameStrokeWidthValue = this.resolveFrameStrokeWidth(singlePairReferenceHeight);
      // scaleも縁取りと同じ発想で「組数1だったときの大きさ」を目標にする——
      // 個人キャンバス(frameKind:"single")が画面の大きさいっぱいまで(上限までは)
      // 大きく描けるのと同じように、共有ビューの各レンズも複数組を並べる前提で
      // 一律に縮めるのではなく、まず「1組だけなら出せる大きさ」をそのまま使う。
      // 以前はouterX/outerY(組数ぶん伸びた全体の範囲)にアスペクト比を合わせて
      // コンテナへ収めていたため、組を横に並べる（chooseLensSplitDirection="row"、
      // 通常のPC/大画面）ほど全体の横幅ばかり伸びて縦横比が崩れ、画面がどれだけ
      // 大きくても個々のレンズの高さがどんどん圧迫される不具合があった
      // （回転操作の余地が参加人数だけで狭まる、ユーザー報告：個人キャンバスと
      // 同様に回せるようにすべき）。実際に組数ぶん並べたときに画面へ収まりきる
      // かどうかはfitFactorで別途確認し、収まらない分だけ全体を一律に縮める
      // ——画面が十分大きい間はfitFactor===1のままで、組数が増えても個人キャンバス
      // 相当の大きさを保てる。
      const naturalScale = Math.min(
        computeAutoScale(singlePairReferenceWidth, GLASSES_HORIZONTAL_REACH_WITH_HINGE, this.frameStrokeWidthValue),
        computeAutoScale(singlePairReferenceHeight, GLASSES_VERTICAL_REACH, this.frameStrokeWidthValue)
      );
      const requiredWidth = 2 * outerX * naturalScale;
      const requiredHeight = 2 * outerY * naturalScale;
      const fitFactor = Math.min(
        1,
        requiredWidth > 0 ? containerRect.width / requiredWidth : 1,
        requiredHeight > 0 ? containerRect.height / requiredHeight : 1
      );
      const scale = naturalScale * fitFactor;
      this.canvas.style.width = `${containerSize.width}px`;
      this.canvas.style.height = `${containerSize.height}px`;
      this.canvas.width = Math.round(containerSize.width * this.dpr);
      this.canvas.height = Math.round(containerSize.height * this.dpr);
      this.scaleValue = scale;
      this.centerPxValue = {
        x: containerSize.width / 2,
        y: containerSize.height / 2 - computeChromeCenterOffsetY(this.container),
      };
      this.lensSplitPairCentersValue = this.lensSplitPairCountValue !== null ? pairCenters : null;
    } else {
      const referenceSize =
        this.minCanvasSizePx !== undefined
          ? computeSquareSize(this.container, this.minCanvasSizePx)
          : computeSquareSize(this.container);
      const containerSize = computeContainerSize(this.container, this.minCanvasSizePx);
      this.frameStrokeWidthValue = this.resolveFrameStrokeWidth(referenceSize);
      const { scale, centerPx } = fitCanvasToContainer(
        this.canvas,
        this.container,
        this.dpr,
        this.contentScaleFactor,
        referenceSize,
        containerSize
      );
      this.scaleValue = scale;
      this.centerPxValue = { x: centerPx.x, y: centerPx.y - computeChromeCenterOffsetY(this.container) };
      this.lensSplitPairCentersValue = null;
    }
    this.rebuildFramePaths();
  }

  private resolveFrameStrokeWidth(canvasSizePx: number): number {
    return typeof this.frameStrokeWidthOption === "function"
      ? this.frameStrokeWidthOption(canvasSizePx)
      : this.frameStrokeWidthOption;
  }

  /** クリップ境界と外枠線のPath2Dを、今のscale/フレーム形状/縁の太さから組み立て直す。
   *  resize()（コンテナサイズ変化時）とsetFrameShape()（resize()経由）でだけ呼ばれる。 */
  private rebuildFramePaths(): void {
    const shape = this.currentShape();
    // strokePathはframePathを「一定距離（frameStrokeWidth）だけ外側に
    // オフセットした」輪郭として組み立てる——以前はscale自体をscale+
    // frameStrokeWidth/2に置き換える「一様スケール」で近似していたが、直線から
    // 曲線へ切り替わる場所（squareの角、glassesの接合部の付け根）では一様スケール
    // が実際の一定距離オフセットと一致せず、縁取りと内側の紙の間に隙間ができて
    // しまっていた（ユーザー指摘・実測確認済み）。buildPathのoffset引数（scaleは
    // 据え置き、各パーツの大きさにoffsetを足す）を使うことで、この隙間が生まれない。
    //
    // offsetの大きさはframeStrokeWidthそのもの（半分ではない）にする——
    // 塗りつぶし(fill)後に紙でframePathぶんを隠すことで縁取りを表現する今の
    // 方式では、見た目の縁取りの太さ＝strokePathとframePathの差分＝offset
    // そのものになる（以前のctx.stroke()方式は、centerlineをframeStrokeWidth/2
    // だけオフセットしたpathを、さらにlineWidth=frameStrokeWidthでストローク
    // することで両側にframeStrokeWidth/2ずつ広がっていたため、offsetは半分で
    // 良かった——fill方式に変えた際にこの半分だけ残ってしまっており、縁取りが
    // 本来の半分の太さしかなくなっていた。ユーザー指摘）。
    const offset = this.frameStrokeWidthValue;
    if (this.frameKindValue === "glasses") {
      // 「接合部をフレームと同じ太さに」（ユーザー指示）: ブリッジの半分の高さを
      // frameStrokeWidth（px）から今のscaleで正規化単位に逆算し、buildPathに
      // 渡す——buildPath自体は固定のデフォルト値ではなく、この値でブリッジの
      // 切り欠き位置を決める。
      this.glassesBridgeHalfHeight = this.frameStrokeWidthValue / 2 / this.scaleValue;
      this.framePathValue = shape.buildPath(this.scaleValue, this.glassesBridgeHalfHeight, 0);
      this.strokePathValue = shape.buildPath(this.scaleValue, this.glassesBridgeHalfHeight, offset);
    } else {
      this.framePathValue = shape.buildPath(this.scaleValue);
      this.strokePathValue = shape.buildPath(this.scaleValue, undefined, offset);
    }
    this.frameStyleValue = getFramePattern(this.framePatternId).buildStyle(
      this.ctx,
      this.scaleValue * shape.horizontalReach
    );
    // レンズ分割時は、設定された柄を起点にFRAME_PATTERN_ORDERを組の数ぶん順送り
    // した柄一覧を組別に用意する——同じ柄が並び続けると見分けが付かず単調に
    // 見える(issue #79、ユーザー指摘)ため。単一表示(pairCount===null)では
    // 空配列のままにし、frameStyleForPair()がframeStyleValueへフォールバックする。
    this.pairFrameStyles =
      this.frameKindValue === "glasses" && this.lensSplitPairCountValue !== null
        ? this.buildPairFrameStyles(this.lensSplitPairCountValue, this.scaleValue * shape.horizontalReach)
        : [];
    this.pairFramePatternIds =
      this.frameKindValue === "glasses" && this.lensSplitPairCountValue !== null
        ? this.buildPairFramePatternIds(this.lensSplitPairCountValue)
        : [];
    // 柄と同様、レンズ分割時は組ごとに形状(丸眼鏡/楕円/長方形)も順送りする
    // (issue #113③)。組ごとに形状そのものが異なるため、柄と違いPath2Dも
    // 組ごとに個別に組み立て直す必要がある——glassesBridgeHalfHeight/offsetは
    // 形状に依らない値(frameStrokeWidth/scaleだけから決まる)なのでそのまま使い回せる。
    this.pairFrameShapeIds =
      this.frameKindValue === "glasses" && this.lensSplitPairCountValue !== null
        ? this.buildPairFrameShapeIds(this.lensSplitPairCountValue)
        : [];
    this.pairFramePaths = this.pairFrameShapeIds.map((id) =>
      getGlassesFrameShape(id).buildPath(this.scaleValue, this.glassesBridgeHalfHeight, 0)
    );
    this.pairStrokePaths = this.pairFrameShapeIds.map((id) =>
      getGlassesFrameShape(id).buildPath(this.scaleValue, this.glassesBridgeHalfHeight, offset)
    );
  }

  private buildPairFrameStyles(pairCount: number, reachPx: number): (CanvasPattern | CanvasGradient | string)[] {
    return this.buildPairFramePatternIds(pairCount).map((patternId) =>
      getFramePattern(patternId).buildStyle(this.ctx, reachPx)
    );
  }

  private buildPairFramePatternIds(pairCount: number): FramePatternId[] {
    const baseIndex = FRAME_PATTERN_ORDER.indexOf(this.framePatternId);
    return Array.from({ length: pairCount }, (_, i) =>
      // 「メガネ2」(i===1)に手動上書きがあれば、自動ローテーションより優先する(issue #113④)。
      i === 1 && this.pair2PatternOverride !== null
        ? this.pair2PatternOverride
        : FRAME_PATTERN_ORDER[(baseIndex + i) % FRAME_PATTERN_ORDER.length]
    );
  }

  private buildPairFrameShapeIds(pairCount: number): FrameShapeId[] {
    const baseIndex = FRAME_SHAPE_ORDER.indexOf(this.frameShapeIdValue);
    return Array.from({ length: pairCount }, (_, i) =>
      i === 1 && this.pair2ShapeOverride !== null
        ? this.pair2ShapeOverride
        : FRAME_SHAPE_ORDER[(baseIndex + i) % FRAME_SHAPE_ORDER.length]
    );
  }

  /** フレーム形状（丸眼鏡/楕円/長方形）を切り替える。次のrender()から反映される。 */
  setFrameShape(id: FrameShapeId): void {
    this.frameShapeIdValue = id;
    // 動的計算時のscale自体はMAX_SHAPE_REACH基準で形状に関わらず一定だが、
    // クリップ境界・紙の塗り範囲（drawRuledPaperのfillHalfExtent）は形状ごとに
    // 異なるため、次のrender()で正しく反映されるようここでresize()して
    // centerPx等を確定させておく。
    this.resize();
  }

  /** フレームの柄・質感（マット/べっ甲/クリア/木目）を切り替える。
   *  frameKindに関わらず反映される（個人キャンバス/共有キャンバス共通）。 */
  setFramePattern(id: FramePatternId): void {
    this.framePatternId = id;
    this.resize();
  }

  /** ヒンジ（フレームの縁から外側に飛び出す小さな角丸タブ）を描く。正面から
   *  見た実物の眼鏡はつる（テンプル）が奥に折れてほぼ見えないため、つるの線は
   *  描かず、縁に付く小さな出っ張りだけを残す（ユーザー指摘・参考イラスト）。
   *  内側の端は縁取りの外側の端（strokePathの実際の見た目の縁）にぴったり付け、
   *  そこから外側にタブを伸ばす——単に外側の水平先端（scale*horizontalReach）
   *  を中心に置くと、縁取りの内側に埋もれて見えてしまうため（ユーザー指摘）。
   *  strokePathはframePathをframeStrokeWidthぶん外側にオフセットした輪郭
   *  （rebuildFramePaths参照）なので、水平方向の実際の外側の縁は
   *  scale*horizontalReach + frameStrokeWidthになる——以前はcomputeOuterReach
   *  （ctx.stroke()でframeStrokeWidth/2ずつ両側に広がっていた旧方式向けの式）を
   *  流用していたが、fillベースの新方式では値が合わずヒンジが縁から離れて
   *  見えてしまっていた（ユーザー指摘）。
   *
   *  タブの大きさはthis.frameStrokeWidthValue（ウィンドウサイズに応じて動的に
   *  変わりうる）の倍率ではなく、ブリッジと同じthis.scale基準（正規化単位）で
   *  決める——frameStrokeWidthの倍率にすると、フレームを太くするたびにヒンジ
   *  まで連動して肥大化してしまい、独立に調整できない（ユーザー指摘）。
   *
   *  directions（既定は両側）は片眼鏡（frameKind==="monocle"、canvasView.ts参照）
   *  向け——単一レンズの片側だけに、チェーン/つるの取り付け部を思わせるタブを
   *  1つだけ出したいため、[1]や[-1]のように片方だけ渡せるようにしてある。
   *  shape（FrameShape）はhorizontalReachさえ持っていればよく、"glasses"系・
   *  "single"系のどちらの形状でも同じ計算式で成立する。 */
  drawHingeTabs(
    ctx: CanvasRenderingContext2D,
    shape: FrameShape,
    style: CanvasPattern | CanvasGradient | string = this.frameStyleValue,
    directions: readonly (1 | -1)[] = [1, -1]
  ): void {
    const frameOuterEdge = this.scaleValue * shape.horizontalReach + this.frameStrokeWidthValue;
    const tabLength = this.scaleValue * GLASSES_HINGE_TAB_LENGTH;
    const tabHalfHeight = this.scaleValue * GLASSES_HINGE_TAB_HALF_HEIGHT;
    const tabRadius = this.scaleValue * GLASSES_HINGE_TAB_RADIUS;

    for (const direction of directions) {
      const innerX = direction * frameOuterEdge;
      const outerX = innerX + direction * tabLength;
      const left = Math.min(innerX, outerX);

      ctx.beginPath();
      ctx.roundRect(left, -tabHalfHeight, tabLength, tabHalfHeight * 2, tabRadius);
      ctx.fillStyle = style;
      ctx.fill();
    }
  }

  /** 片眼鏡（frameKind==="monocle"、実験中）のチェーン。タブ（drawHingeTabs）
   *  自体はそのまま残し、その下端から垂らす（ユーザー指示：出っ張りはそのまま
   *  で、その下にチェーンを伸ばすイメージ）。フレームの柄・質感（frameStyle、
   *  "フレームなし"だと紙と同じ白）とは独立した固定色で描く——単色のタブ
   *  だけだと「フレームなし」の時に白い塊として見えづらくなってしまう
   *  （ユーザー指摘）ため、フレームの見た目に関わらずチェーンだけは常に見える
   *  ようにする。輪を9つ、左右に揺らさず真下へ直線に連ねる（ユーザー指示）。
   *
   *  普段はインク色（MONOCLE_CHAIN_INK_COLOR）で他の線と馴染ませ、ダーク
   *  テーマの時だけ（isDarkThemeActive()）暗い紙の背景に同化して見えづらく
   *  なる（ユーザー報告）ため、シルバーの金属色へ差し替える。シルバー側は
   *  横方向の明暗グラデーション（MONOCLE_CHAIN_SHADOW/HIGHLIGHT/BASE_COLOR）
   *  で丸線に光沢を持たせる（ユーザー指示：金属らしい光沢感）。 */
  drawMonocleChain(ctx: CanvasRenderingContext2D, shape: FrameShape): void {
    const frameOuterEdge = this.scaleValue * shape.horizontalReach + this.frameStrokeWidthValue;
    const tabLength = this.scaleValue * GLASSES_HINGE_TAB_LENGTH;
    const tabHalfHeight = this.scaleValue * GLASSES_HINGE_TAB_HALF_HEIGHT;
    // タブ（drawHingeTabsが同じ位置に描く矩形）の水平中央・下端を鎖の起点にする。
    const anchorX = frameOuterEdge + tabLength / 2;
    const anchorY = tabHalfHeight;
    const linkRadius = this.scaleValue * MONOCLE_CHAIN_LINK_RADIUS;
    const linkSpacing = this.scaleValue * MONOCLE_CHAIN_LINK_SPACING;

    if (isDarkThemeActive()) {
      // 輪はどれも同じcx・半径なので、横方向のグラデーションを1つだけ作って
      // 全ての輪で使い回す（輪ごとに作り直す必要が無い）。左寄りにハイライトを
      // 置くことで、光源が左上にあるような金属の丸線らしい反射に見せる。
      const chainGradient = ctx.createLinearGradient(anchorX - linkRadius, 0, anchorX + linkRadius, 0);
      chainGradient.addColorStop(0, MONOCLE_CHAIN_SHADOW_COLOR);
      chainGradient.addColorStop(0.32, MONOCLE_CHAIN_HIGHLIGHT_COLOR);
      chainGradient.addColorStop(0.55, MONOCLE_CHAIN_BASE_COLOR);
      chainGradient.addColorStop(1, MONOCLE_CHAIN_SHADOW_COLOR);
      ctx.strokeStyle = chainGradient;
    } else {
      ctx.strokeStyle = MONOCLE_CHAIN_INK_COLOR;
    }
    ctx.lineWidth = Math.max(1, this.scaleValue * MONOCLE_CHAIN_LINE_WIDTH);
    for (let i = 0; i < MONOCLE_CHAIN_LINK_COUNT; i++) {
      const cx = anchorX;
      const cy = anchorY + linkRadius + i * linkSpacing;
      ctx.beginPath();
      ctx.arc(cx, cy, linkRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** ブリッジ（接合部）を、フレームと同じ柄・質感で塗りつぶす。書き込める領域は
   *  レンズの内側だけ（clampToGlasses参照）なので、ここは常にフレーム素材で覆い、
   *  紙の罫線を透けさせない——クリップ(framePath)の外側（render()参照）で、
   *  strokePath自身のブリッジの高さ（frameStrokeWidthぶんオフセットした後の高さ、
   *  glassesBridgeHalfHeight*scale + frameStrokeWidth）ぴったりに塗る。
   *
   *  framePath基準の高さ（オフセット前）ぴったりに塗っていた以前の版は、
   *  strokePathの方がブリッジでもoffsetぶん背が高く、framePathの外側
   *  （紙で隠れない）にフレーム色の帯がすでに描かれていた——それをclampToGlasses
   *  でクリップしたbridge-barが覆いきれず、紙とその帯の境目が細い筋として
   *  見えてしまっていた（ユーザー指摘・実測確認済み）。strokePath自身の高さに
   *  合わせて塗ることで、この帯ごと同じ1枚のフィルで覆い、境目自体をなくす。 */
  drawGlassesBridgeBar(
    ctx: CanvasRenderingContext2D,
    style: CanvasPattern | CanvasGradient | string = this.frameStyleValue,
    shapeId: FrameShapeId = this.frameShapeIdValue
  ): void {
    const halfWidth = this.scaleValue * glassesBridgeHalfWidth(shapeId, this.glassesBridgeHalfHeight);
    const halfHeight = this.scaleValue * this.glassesBridgeHalfHeight + this.frameStrokeWidthValue;
    ctx.fillStyle = style;
    ctx.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
  }
}
