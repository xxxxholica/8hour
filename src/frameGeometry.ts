import {
  computeChromeCenterOffsetY,
  computeContainerSize,
  computeSquareSize,
  fitCanvasToContainer,
} from "./canvasSizing";
import { CANVAS_FRAME_SHAPE } from "./frameShape";
import type { FrameShape } from "./frameShape";
import type { Point } from "./types";

interface FrameGeometryOptions {
  contentScaleFactor?: number | ((size: number) => number);
  /** computeSquareSizeの下限をMIN_CANVAS_SIZE(200px)から差し替える。
   *  CircularCanvasOptions.minCanvasSizePx参照。 */
  minCanvasSizePx?: number;
}

/**
 * `CircularCanvas`（canvasView.ts）からフレーム形状・サイズ計算に関わる状態を
 * ひとまとめにしたもの（canvasView.tsが1000行超まで肥大化したための整理、
 * Refactor）。`canvas`/`ctx`/`container`/`dpr`は他の関心事（ポインタ操作・
 * テキスト編集など）からも広く参照される共有インフラのため、ここには持たせず
 * 参照として受け取るだけにする——`CircularCanvas`が引き続き所有する。
 *
 * メモの座標は「キャンバスの半辺を1とする正規化座標」で保存する（中心が原点、
 * 枠の辺の中点が距離1）。こうしておくとウィンドウサイズが変わってキャンバスの
 * 物理的な大きさ（px）が変化しても、既存のメモが縮んで見えたり位置がずれたり
 * しない——ウィンドウを広げれば単純にその分だけ拡大して描かれる。
 *
 * 枠線・柄（マット/べっ甲/クリア/木目）は撤去し、CSSのdrop-shadowで浮かせる
 * 見た目に置き換えた（ユーザー指示）ため、このクラスは紙のクリップ境界
 * （framePath）だけを扱う——縁取りの太さ・柄に関する状態は一切持たない。
 */
export class FrameGeometry {
  private scaleValue = 0;
  private centerPxValue: Point = { x: 0, y: 0 };
  private contentScaleFactor: number | ((size: number) => number) | undefined;
  private minCanvasSizePx: number | undefined;
  /** クリップに使うPath2D。scaleが変わるresize()のタイミングでだけ組み立て
   *  直し、render()（毎フレーム）では使い回す——Path2Dの構築自体は軽くないため。 */
  private framePathValue: Path2D = new Path2D();

  private canvas: HTMLCanvasElement;
  private container: HTMLElement;
  private dpr: number;

  constructor(
    canvas: HTMLCanvasElement,
    container: HTMLElement,
    dpr: number,
    options: FrameGeometryOptions = {}
  ) {
    this.canvas = canvas;
    this.container = container;
    this.dpr = dpr;
    this.contentScaleFactor = options.contentScaleFactor;
    this.minCanvasSizePx = options.minCanvasSizePx;
    this.resize();
  }

  get scale(): number {
    return this.scaleValue;
  }

  get centerPx(): Point {
    return this.centerPxValue;
  }

  get framePath(): Path2D {
    return this.framePathValue;
  }

  /** キャンバスの枠形状（正方形・角丸、固定）。 */
  currentShape(): FrameShape {
    return CANVAS_FRAME_SHAPE;
  }

  /** キャンバス要素自体は、利用可能な幅・高さいっぱいの矩形として広げる。
   *  フレーム（正方形・角丸）の描画基準サイズはこれとは別に、利用可能な
   *  幅・高さのうち小さい方（上下限だけ設ける）をそのまま使う——キャンバス
   *  領域を画面いっぱいに広げても、フレームの見た目の大きさ自体は変えない
   *  ため（issue #83、ユーザー指示）。
   *
   *  中心（centerPxValue）はキャンバス要素の幾何中心からcomputeChromeCenterOffsetY()
   *  ぶんだけ上へ補正する——ヘッダー・フッターは画面の真の上端／下端に固定表示
   *  される半透明の帯で、キャンバス要素自体はその下まで含めて画面いっぱいに
   *  広がるため、補正しないとフッター（ヘッダーより背が高い）側へフレームが寄って
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
    const referenceSize =
      this.minCanvasSizePx !== undefined
        ? computeSquareSize(this.container, this.minCanvasSizePx)
        : computeSquareSize(this.container);
    const containerSize = computeContainerSize(this.container, this.minCanvasSizePx);
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
    this.rebuildFramePaths();
  }

  /** クリップ境界のPath2Dを、今のscaleから組み立て直す。resize()（コンテナ
   *  サイズ変化時）でだけ呼ばれる。 */
  private rebuildFramePaths(): void {
    this.framePathValue = this.currentShape().buildPath(this.scaleValue);
  }
}
