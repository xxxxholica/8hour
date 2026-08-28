/**
 * レポート用紙(ノート)風の背景。呼び出し側であらかじめ円のクリップを設定し、
 * 円の中心を原点にtranslate済みのコンテキストに対して呼ぶこと。
 */

const PAPER_WHITE = "#ffffff";
const RULE_LINE = "oklch(78% 0.07 240 / 0.4)";

/** 罫線の間隔を決める分割数（半径1単位をこの数で割った間隔で線を引く）。 */
const RULE_LINE_DIVISIONS = 7;

/**
 * @param radius 罫線の間隔・太さの基準（正規化1単位=半径1に対応するpx）。
 * @param fillHalfExtent 実際に紙面を塗り広げる半径（省略時はradiusと同じ）。
 *   Oval/Squareのように、クリップ境界がradius基準の正方形（-radius..radius）
 *   より外まで張り出す形状では、これを大きめに渡さないと紙の外側（クリップ
 *   境界の内側だが正方形の外側）が塗られず背景色のまま透けて見えてしまう
 *   ——罫線の間隔・太さの基準はradiusのまま据え置き、塗る範囲だけを広げる。
 */
export function drawRuledPaper(
  ctx: CanvasRenderingContext2D,
  radius: number,
  fillHalfExtent: number = radius
): void {
  // コンテナが非表示（hidden）の間にResizeObserver経由でresize()が走ると、
  // 計測されたコンテナサイズが0になり、frame.scale（=このradius）も0になる
  // ——共有タブへ戻った直後、この0がrender()にまだ残っている間に呼ばれると、
  // 罫線の間隔(spacing = radius / RULE_LINE_DIVISIONS)が0になり、下のループの
  // yが全く進まなくなってメインスレッドを止める無限ループになる
  // （実機で再現・Firefox Profilerで確認済み——CanvasRenderingContext2D.stroke/
  // moveToが延々サンプリングされてタブがクラッシュしていた）。描画に使えない
  // 大きさ（0以下・NaN・Infinity）の間は何もせず抜け、実際のサイズが決まった
  // 次のresize()後のフレームで正しく描かれるようにする。
  if (!(radius > 0) || !(fillHalfExtent > 0) || !Number.isFinite(radius) || !Number.isFinite(fillHalfExtent)) {
    return;
  }

  ctx.fillStyle = PAPER_WHITE;
  ctx.fillRect(-fillHalfExtent, -fillHalfExtent, fillHalfExtent * 2, fillHalfExtent * 2);

  const spacing = radius / RULE_LINE_DIVISIONS;
  ctx.strokeStyle = RULE_LINE;
  ctx.lineWidth = Math.max(1, radius / 300);
  // 罫線ごとにbeginPath/strokeを呼ぶと、線の本数だけstroke()の固定オーバーヘッドが
  // 積み重なり、毎フレーム呼ばれるrender()の中で無視できないCPU負荷になっていた
  // （SMUIの共有キャンバスは通常キャンバスより罫線本数が多く、フリーズとして
  // 実機で再現・Firefox Profilerで確認済み）。全ての罫線を1本のパスにまとめ、
  // stroke()を1回だけ呼ぶことで見た目を変えずにこのコストを解消する。
  ctx.beginPath();
  for (let y = -fillHalfExtent; y <= fillHalfExtent; y += spacing) {
    ctx.moveTo(-fillHalfExtent, y);
    ctx.lineTo(fillHalfExtent, y);
  }
  ctx.stroke();
}
