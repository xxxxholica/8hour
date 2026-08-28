import type { Point } from "./types";

/** キャンバスの一辺（px）の下限・上限。極端に小さい/大きいウィンドウでも破綻しないように。
 *  通常キャンバスと振り返りのプレビューキャンバスの両方がこの定数を共有することで、
 *  「同じ大きさ」を保証する。 */
const MIN_CANVAS_SIZE = 200;
/** 以前は900だったが、上部のタイトル表示を廃止して画面切り替えを下部の操作パネルに
 *  統合したことで縦方向の余白が増えたため、円をさらに大きく見せられるよう引き上げた。 */
const MAX_CANVAS_SIZE = 1100;

interface CanvasGeometry {
  width: number;
  height: number;
  /** px per 正規化単位（円の半径px）。 */
  scale: number;
  centerPx: Point;
}

/**
 * コンテナの利用可能な幅・高さのうち小さい方いっぱいまで正方形として広げた時の
 * 一辺（px）。上下限（既定でMIN/MAX_CANVAS_SIZE）だけ設ける。SMUIの右レンズ
 * プレースホルダー（smuiView.ts）が、実際にCircularCanvasが無い間も同じ大きさの
 * 円に見えるよう、この計算だけを単独で使えるようにexportしている。frameKind===
 * "single"では、キャンバス要素自体の大きさではなく、フレーム（円/楕円/長方形）
 * の描画基準サイズ（contentScaleFactorを掛ける前の値）としてだけ使う——
 * computeContainerSize参照。
 * minSize/maxSizeを省略時のMIN/MAX_CANVAS_SIZEから上書きできるのは、使い方
 * ページの練習用サンドボックス（tutorialSandbox.ts、CircularCanvasOptions.
 * minCanvasSizePx）専用——本物のMIN_CANVAS_SIZE(200px)のままだと、CSS側で
 * コンテナをそれより小さく（.tutorial-sandbox-canvas-wrap、style.css）
 * 縮めても、この関数がその小ささを無視して200pxのまま返してしまい、
 * canvas要素がコンテナからはみ出して下の説明文と重なって見える不具合が
 * あった（ユーザー報告）。
 */
export function computeSquareSize(
  container: HTMLElement,
  minSize: number = MIN_CANVAS_SIZE,
  maxSize: number = MAX_CANVAS_SIZE
): number {
  const rect = container.getBoundingClientRect();
  const available = Math.min(rect.width, rect.height || rect.width);
  return Math.min(maxSize, Math.max(minSize, available));
}

/**
 * コンテナの利用可能な幅・高さを、正方形に制限せずそのまま返す（下限だけ
 * MIN_CANVAS_SIZEで保証し、極端に狭いレイアウトでの退化を防ぐ。上限は設けない
 * ——キャンバス要素の領域を画面いっぱいに使うのが目的のため）。frameKind==="single"の
 * キャンバス要素の実サイズ（style幅高さ・描画バッファ）に使う。フレームの描画基準
 * サイズ（computeSquareSize）とは別の値で、両者はfitCanvasToContainerで
 * 組み合わせる。
 */
export function computeContainerSize(
  container: HTMLElement,
  minSize: number = MIN_CANVAS_SIZE
): { width: number; height: number } {
  const rect = container.getBoundingClientRect();
  const width = Math.max(minSize, rect.width);
  const height = Math.max(minSize, rect.height || rect.width);
  return { width, height };
}

/**
 * 太い縁取り（frameStrokeWidthピクセル、外枠パスを中心線としてその半分ずつ
 * 内外にはみ出す形で描く——canvasView.ts render()のstrokeScale参照）を持つ
 * 形状が、キャンバスの箱（一辺size）からはみ出さないぎりぎりの大きさで収まる
 * scale（正規化1単位あたりのpx）を計算する。maxReachはこの形状が原点から
 * 最も遠くまで届く距離（正規化単位、frameShape.ts参照）。
 *
 * 縁取りの外側の端までの距離は maxReach*(scale + frameStrokeWidth/2) +
 * frameStrokeWidth/2で、これがsize/2を超えないようscaleを逆算する
 * （実際の縁取り描画がfillベースになった今の方式が必要とする余白
 * maxReach*scale + frameStrokeWidthより常に大きい、安全側の見積もり）。
 *
 * SMUIのレンズ（canvasView.ts）が、固定のcontentScaleFactorではなく
 * 「今のキャンバスの大きさ・縁取りの太さで安全な範囲でなるべく大きく」を
 * 動的に計算するために使う——固定の割合だと、極端に小さいレンズ（MIN_CANVAS_SIZE
 * 付近）でも縁取りが切れない値に合わせて常に控えめにする必要があり、通常の
 * 大きさのレンズでは余白を必要以上に持て余してしまうため。
 */
export function computeAutoScale(size: number, maxReach: number, frameStrokeWidth: number): number {
  const scale = size / (2 * maxReach) - (frameStrokeWidth * (maxReach + 1)) / (2 * maxReach);
  return Math.max(0, scale);
}

/**
 * コンテナの利用可能な幅・高さに収まる、指定アスペクト比（幅/高さ）の最大の
 * 矩形サイズを返す。高さ（aspectRatio>=1を前提に短辺側になる）にだけ
 * MIN/MAX_CANVAS_SIZEを適用する。共有キャンバス（眼鏡形状、横長）が
 * computeSquareSize/fitCanvasToContainerの「常に正方形」という前提に
 * 合わないため、横長コンテナ向けに新設した。
 */
export function computeRectSize(container: HTMLElement, aspectRatio: number): { width: number; height: number } {
  const rect = container.getBoundingClientRect();
  const availW = rect.width;
  const availH = rect.height || rect.width / aspectRatio;

  let width = availW;
  let height = width / aspectRatio;
  if (height > availH) {
    height = availH;
    width = height * aspectRatio;
  }

  height = Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, height));
  width = height * aspectRatio;

  // MIN_CANVAS_SIZEへの引き上げは、狭い画面×横長のaspectRatio（眼鏡形状など）
  // では幅がavailWを超えてしまうことがある——コンテナの外にはみ出す（ヒンジ等の
  // 装飾が画面端で切れる）よりは、下限を割ってでも幅内に収める方を優先する。
  if (width > availW) {
    width = availW;
    height = width / aspectRatio;
  }
  return { width, height };
}

/**
 * canvas要素の実サイズ（style幅高さ・描画バッファ）をcontainerSize（既定は
 * コンテナいっぱい、正方形に限らない矩形——computeContainerSize参照）に合わせ、
 * 以後の座標計算に使うscale・中心を返す。scale自体はcontainerSizeとは別の
 * referenceSize（既定はcomputeSquareSize(container)、正方形基準の値）に
 * contentScaleFactorを掛けて決める——キャンバス要素の領域を画面いっぱいに
 * 広げても、フレーム（円/楕円/長方形）の見た目の大きさ自体は変えないため、
 * この2つを独立させている。
 * contentScaleFactorは固定の割合（数値）のほか、referenceSize（px）を
 * 受け取ってその都度の割合を返す関数も渡せる（SMUIレンズの動的マージン計算、
 * computeAutoScale参照）。呼び出し元がすでにcomputeSquareSize(container)/
 * computeContainerSize(container)を計算済みなら、getBoundingClientRect()の
 * 二重呼び出しを避けるためreferenceSize/containerSizeで渡せる。
 */
/**
 * ヘッダー・フッターは画面の真の上端／下端に固定表示される半透明の帯で、
 * キャンバス要素自体はその下まで含めて画面いっぱいに広がる——ズーム・パン
 * した絵がヘッダー/フッターの下まで透けて見えるようにするための意図的な
 * 設計（style.css .app-header/.app-footerのコメント参照）。そのため円の
 * 中心を単純にキャンバス要素の幾何中心へ置くと、フッター（下端の余白を
 * 他3辺より広めに取っている・道具バーを含む）の方がヘッダーより背が高い分
 * だけ、円が見た目にはツールバー側へ寄って見えてしまう（ユーザー指摘）。
 * ヘッダー・フッターの高さの差の半分だけ円の中心を上へ補正する値を返す
 * ——見えている帯の間（ヘッダー下端〜フッター上端）のちょうど中央に円が
 * 来るようにするための量。ヘッダー/フッターが存在しない文脈（使い方ガイドの
 * 練習用サンドボックス等）では0を返す。 */
export function computeChromeCenterOffsetY(container?: HTMLElement): number {
  // 使い方ガイド内の練習キャンバスはアプリ本体のヘッダー・フッターに挟まれた
  // レイアウトではないため、本体向けの上方向補正を適用しない。
  if (container?.closest(".usage-guide")) return 0;
  const header = document.querySelector<HTMLElement>(".app-header");
  const footer = document.querySelector<HTMLElement>(".app-footer");
  if (!header || !footer) return 0;
  return (footer.getBoundingClientRect().height - header.getBoundingClientRect().height) / 2;
}

export function fitCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  dpr: number,
  contentScaleFactor: number | ((size: number) => number) = 0.43,
  referenceSize: number = computeSquareSize(container),
  containerSize: { width: number; height: number } = computeContainerSize(container)
): CanvasGeometry {
  const factor = typeof contentScaleFactor === "function" ? contentScaleFactor(referenceSize) : contentScaleFactor;
  const scale = referenceSize * factor;
  const { width, height } = containerSize;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  return { width, height, scale, centerPx: { x: width / 2, y: height / 2 } };
}
