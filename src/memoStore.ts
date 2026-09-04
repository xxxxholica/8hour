import { circleIntersectsBox, eraseFromStroke, isInsideClamp, restrictTranslation } from "./geometry";
import { CANVAS_FRAME_SHAPE } from "./frameShape";
import { loadMemos, saveMemos } from "./storage";
import { LINE_HEIGHT_MULTIPLIER } from "./textLayout";
import type { Memo, MemoStyle, Point, Stroke, TextMemo } from "./types";

function makeId(): string {
  return `memo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** undo履歴に積むスナップショットの上限。無制限に積み続けるとメモリを圧迫する
 *  ため、一定数を超えたら一番古いものから捨てる（issue #89：「入力ミスをした
 *  直後の数秒間」を取り消せれば十分、という要求なのでlocalStorageへの永続化は
 *  せず、ページを再読み込みすれば履歴は消える簡易版でよい）。 */
const MAX_UNDO_HISTORY = 50;

/** insertCopyで元のメモの位置に加えるランダムなオフセットの最大量（正規化座標、
 *  円の半径=1基準）。過去めくり画面から今日のキャンバスへドロップした複製が
 *  元の場所にぴったり重ならないよう、わずかにずらす（ユーザー指示）。 */
const COPY_POSITION_JITTER = 0.03;

/**
 * メモ全体の状態を保持し、既定ではlocalStorageと同期させるストア。
 * 保存・復元・全体リセットをまとめて担う。
 */
export class MemoStore {
  private memos: Memo[];
  private onChange?: (memos: readonly Memo[]) => void;
  private persistLocally: boolean;
  /** undo/redo用の完全スナップショット履歴（issue #89）。個々の操作の逆処理を
   *  操作ごとに書く（コマンドパターン）のではなく、操作の直前の全メモ配列を
   *  丸ごと複製して積む方式にした——描画・消去・移動・テキスト編集など操作の
   *  種類が多く、それぞれに逆操作を実装するとバグの温床になりやすい一方、
   *  メモ配列はそのままlocalStorageに保存できる程度に軽い（JSON化可能な）
   *  データなので、丸ごと複製するコストは許容できる。ページを再読み込みすれば
   *  消える前提（localStorageには保存しない）のため、量が増えすぎないよう
   *  MAX_UNDO_HISTORY件で古いものから捨てる。 */
  private undoStack: Memo[][] = [];
  private redoStack: Memo[][] = [];

  /**
   * persistLocallyをfalseにすると、localStorage["memos"]を一切読み書きしない
   * （本物のキャンバスと衝突させたくないチュートリアルのサンドボックス用インスタンス、
   * tutorialSandbox.ts参照）。
   */
  constructor(onChange?: (memos: readonly Memo[]) => void, persistLocally: boolean = true) {
    this.persistLocally = persistLocally;
    this.memos = persistLocally ? loadMemos() : [];
    this.onChange = onChange;
  }

  private persist(): void {
    if (this.persistLocally) saveMemos(this.memos);
    this.onChange?.(this.memos);
  }

  /**
   * これから始まる一連の操作（1回のドラッグでの描画・消去・移動・振り回し、
   * または1回のテキスト編集セッション全体）の直前の状態を、undo履歴に積む。
   * 呼び出し側（canvasView.ts）が、ジェスチャー中で最初にストアを書き換える
   * 直前に1回だけ呼ぶ責任を持つ——ポインタが動くたびに何度も呼ぶと、1回の
   * ドラッグが何十もの細かいundoステップに分かれてしまい「直前の操作を戻す」
   * という直感に合わなくなるため。新しい操作が始まった時点でredo履歴は
   * 無効になる（一般的なundo/redoの挙動）。
   */
  snapshotForUndo(): void {
    this.undoStack.push(structuredClone(this.memos));
    if (this.undoStack.length > MAX_UNDO_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  /** 直前の操作を取り消す。取り消せる操作が無ければ何もしない。 */
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(structuredClone(this.memos));
    this.memos = prev;
    this.persist();
    return true;
  }

  /** undoで取り消した操作をやり直す。やり直せる操作が無ければ何もしない。 */
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(structuredClone(this.memos));
    this.memos = next;
    this.persist();
    return true;
  }

  /**
   * メモ配列を丸ごと置き換える（tutorialSandbox.tsのシナリオ切り替え用）。
   * 置き換え前のundo/redo履歴は、置き換え後の内容とは無関係な状態を指すことに
   * なるため破棄する。
   */
  replaceAll(memos: Memo[]): void {
    this.memos = memos;
    this.undoStack = [];
    this.redoStack = [];
    if (this.persistLocally) saveMemos(this.memos);
  }

  getAll(): readonly Memo[] {
    return this.memos;
  }

  getActive(): Memo[] {
    return this.memos.filter((m) => m.status === "active");
  }

  /** 新しい手描きメモを1点で開始する（最初のストロークはこの直後に addPointToStroke で積む）。 */
  createMemo(start: Point, style: MemoStyle, now: number = Date.now()): Memo {
    const memo: Memo = {
      id: makeId(),
      kind: "stroke",
      x: start.x,
      y: start.y,
      strokes: [[start]],
      createdAt: now,
      status: "active",
      tool: style.tool,
      color: style.color,
      lineWidth: style.lineWidth,
    };
    this.memos.push(memo);
    this.persist();
    return memo;
  }

  /**
   * 新しいテキストメモを作る。折り返し済みの行(textLines)とボックスサイズ(boxWidth/boxHeight)は
   * 呼び出し側（textLayout.ts の wrapTextAtReferenceScale / normalizedBoxSize）で計算済みのものを渡す
   * ——テキストの折り返しにはcanvasのフォント計測が必要で、ストアはcanvas contextを持たないため。
   */
  createTextMemo(
    anchor: Point,
    text: string,
    textLines: string[],
    fontSize: number,
    boxWidth: number,
    boxHeight: number,
    style: { color: string; align?: "center" | "left"; lineHeight?: number },
    now: number = Date.now()
  ): TextMemo {
    const memo: TextMemo = {
      id: makeId(),
      kind: "text",
      x: anchor.x,
      y: anchor.y,
      text,
      textLines,
      fontSize,
      boxWidth,
      boxHeight,
      createdAt: now,
      status: "active",
      color: style.color,
      align: style.align ?? "center",
      lineHeight: style.lineHeight ?? LINE_HEIGHT_MULTIPLIER,
    };
    this.memos.push(memo);
    this.persist();
    return memo;
  }

  /** 既存メモに新しいストロークを1本追加する（ペンを持ち上げて再度書き始めたとき）。手描きメモにのみ有効。 */
  startStroke(memoId: string, start: Point): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.kind !== "stroke") return;
    memo.strokes.push([start]);
    this.persist();
  }

  /** 直近のストロークに点を追加する。手描きメモにのみ有効。 */
  addPointToLastStroke(memoId: string, point: Point): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.kind !== "stroke" || memo.strokes.length === 0) return;
    const stroke: Stroke = memo.strokes[memo.strokes.length - 1];
    stroke.push(point);
    this.persist();
  }

  /**
   * ドラッグせずに離した（＝直近のストロークが1点のまま）場合の後始末。
   * その1点だけのストロークは描画側（renderMemoAt）で無視され画面には何も
   * 残らないが、ストアには「メモがある」状態が残ってしまい、メモ0件のときだけ
   * 出す初期案内（自由に書いてみる）が誤って出なくなってしまう（ユーザー報告）。
   * そのストロークが唯一のストローク
   * ならメモ自体を削除し、他に有効なストロークが既にある（＝同じ書き込み
   * セッション中に一度書いた後、ペンを持ち上げてもう一度一瞬だけ触れた場合）
   * ならその1点だけのストロークだけを取り除く。
   */
  /** 戻り値はメモ自体を削除したかどうか（呼び出し側でactiveMemoIdの後始末に使う）。 */
  discardTrailingSinglePointStroke(memoId: string): boolean {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.kind !== "stroke" || memo.strokes.length === 0) return false;
    const lastStroke = memo.strokes[memo.strokes.length - 1];
    if (lastStroke.length >= 2) return false;
    if (memo.strokes.length === 1) {
      this.deleteMemo(memoId);
      return true;
    }
    memo.strokes.pop();
    this.persist();
    return false;
  }

  /**
   * 既存のテキストメモの内容を書き換える（テキストの編集機能）。フォントサイズ・色は
   * 変更しない（内容を編集する操作であって、見た目の再設定ではないため）。
   */
  updateTextMemo(memoId: string, text: string, textLines: string[], boxWidth: number, boxHeight: number): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.kind !== "text" || memo.status !== "active") return;
    memo.text = text;
    memo.textLines = textLines;
    memo.boxWidth = boxWidth;
    memo.boxHeight = boxHeight;
    this.persist();
  }

  /** メモを1件削除する（テキスト編集で全文を消して確定した場合など）。 */
  deleteMemo(memoId: string): void {
    const before = this.memos.length;
    this.memos = this.memos.filter((m) => m.id !== memoId);
    if (this.memos.length !== before) {
      this.persist();
    }
  }

  /**
   * メモ全体（手描き・テキストどちらも）を (dx, dy) だけ平行移動する
   * （移動道具でドラッグしている間、ポインタが動くたびに呼ばれる差分移動）。
   * 描画可能領域の外にはみ出す移動は許さない——手描き(stroke)は、各点を
   * 独立にclampして境界へスナップするのではなく、restrictTranslationで
   * ストロークを構成する全ての点が境界内に収まる範囲まで移動量そのものを
   * 比例的に縮める（剛体移動）。点ごとにクランプする方式は、境界に近い点
   * ほど個別に丸め込まれて線の形が歪んでしまう問題があったため、この方式に
   * 変更した（ユーザー指示：移動そのものを制限し、ストローク全体が常に
   * 境界内に収まるようにする）。テキストは代表点(x, y)が箱の中心なので、
   * 中心点だけをclampすると箱の端（±boxWidth/2, ±boxHeight/2）が境界の外に
   * はみ出せてしまう（ユーザー指摘：移動中にテキストが枠外に出る）。そのため
   * 箱の四隅を点群としてrestrictTranslationに渡し、四隅すべてが境界内に
   * 収まる範囲まで移動量を縮める。ただし四隅が最初から境界内に収まっていない
   * （箱そのものが枠に対して大きすぎる）場合は、restrictTranslationが常に
   * 移動量0を返して動かせなくなってしまうため、その場合だけ従来通り中心点の
   * clampにフォールバックする（はみ出しは避けられないが、動かせないよりはよい）。
   * 既定のclampはキャンバスの枠形状（正方形・角丸、frameShape.ts）のもの。
   */
  translateMemo(
    memoId: string,
    dx: number,
    dy: number,
    clamp: (p: Point) => Point = (p) => CANVAS_FRAME_SHAPE.clamp(p)
  ): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.status !== "active") return;
    if (dx === 0 && dy === 0) return;

    if (memo.kind === "stroke") {
      const allPoints = memo.strokes.flat();
      const restricted = restrictTranslation(allPoints, dx, dy, clamp);
      if (restricted.dx === 0 && restricted.dy === 0) return;
      memo.strokes = memo.strokes.map((stroke) =>
        stroke.map((p) => ({ x: p.x + restricted.dx, y: p.y + restricted.dy }))
      );
      const first = memo.strokes[0]?.[0];
      if (first) {
        memo.x = first.x;
        memo.y = first.y;
      }
    } else {
      const halfW = memo.boxWidth / 2;
      const halfH = memo.boxHeight / 2;
      const corners: Point[] = [
        { x: memo.x - halfW, y: memo.y - halfH },
        { x: memo.x + halfW, y: memo.y - halfH },
        { x: memo.x - halfW, y: memo.y + halfH },
        { x: memo.x + halfW, y: memo.y + halfH },
      ];
      if (corners.every((c) => isInsideClamp(c, clamp))) {
        const restricted = restrictTranslation(corners, dx, dy, clamp);
        if (restricted.dx === 0 && restricted.dy === 0) return;
        memo.x += restricted.dx;
        memo.y += restricted.dy;
      } else {
        const moved = clamp({ x: memo.x + dx, y: memo.y + dy });
        memo.x = moved.x;
        memo.y = moved.y;
      }
    }
    this.persist();
  }

  /**
   * 過去めくり画面のドロップ帯へのドラッグ&ドロップ（archiveCanvas.ts）専用: アーカイブ側の
   * メモ1件を、新しいid・作成日時を持つ複製として今日のキャンバスに追加する。渡された
   * memo自体（アーカイブ側）は一切変更しない。元の座標(x, y)に正規化座標で±JITTER程度の
   * ランダムなオフセットを加えた位置に置き、そのオフセットをストローク全体にも均等に
   * 適用する（点ごとに別々のオフセットをかけると形が歪むため、代表点で決めたオフセットを
   * 一律に使う）。オフセットが枠の外へはみ出す場合はclampで枠内に丸め込む——その際も
   * ストロークの形そのものは歪めず、丸め込んだ分の平行移動として反映する。
   */
  insertCopy(memo: Memo, clamp: (p: Point) => Point = (p) => CANVAS_FRAME_SHAPE.clamp(p)): Memo {
    const offsetX = (Math.random() * 2 - 1) * COPY_POSITION_JITTER;
    const offsetY = (Math.random() * 2 - 1) * COPY_POSITION_JITTER;
    const clamped = clamp({ x: memo.x + offsetX, y: memo.y + offsetY });
    const dx = clamped.x - memo.x;
    const dy = clamped.y - memo.y;

    const copy: Memo =
      memo.kind === "stroke"
        ? {
            ...structuredClone(memo),
            id: makeId(),
            createdAt: Date.now(),
            x: clamped.x,
            y: clamped.y,
            strokes: memo.strokes.map((stroke) => stroke.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
          }
        : {
            ...structuredClone(memo),
            id: makeId(),
            createdAt: Date.now(),
            x: clamped.x,
            y: clamped.y,
          };

    this.memos.push(copy);
    this.persist();
    return copy;
  }

  resetAll(): void {
    this.memos = [];
    this.undoStack = [];
    this.redoStack = [];
    this.persist();
  }

  /**
   * 消しゴム: center から radius 以内をアクティブなメモから削除する（本当の手動削除）。
   * 手描きメモはストロークが分断される場合は複数本に分け、全て消えたメモは配列から取り除く。
   * テキストメモは部分削除ができないため、当たり判定用のボックス(boxWidth/boxHeight)に
   * 触れたらメモごと削除する。
   */
  eraseAt(center: Point, radius: number): boolean {
    let changed = false;
    this.memos = this.memos.filter((memo) => {
      if (memo.status !== "active") return true;

      if (memo.kind === "text") {
        const touched = circleIntersectsBox(center, radius, {
          x: memo.x,
          y: memo.y,
          width: memo.boxWidth,
          height: memo.boxHeight,
        });
        if (touched) changed = true;
        return !touched;
      }

      const newStrokes = memo.strokes.flatMap((s) => eraseFromStroke(s, center, radius));
      const strokeCountChanged =
        newStrokes.length !== memo.strokes.length ||
        newStrokes.some((s, i) => s.length !== memo.strokes[i]?.length);
      if (strokeCountChanged) changed = true;
      memo.strokes = newStrokes;
      return newStrokes.length > 0;
    });
    if (changed) {
      this.persist();
    }
    return changed;
  }
}
