import { boxCorners, circleIntersectsBox, clampToRoundedRect, eraseFromStroke, isInsideClamp, restrictTranslation } from "./geometry";
import { loadMemos, saveMemos } from "./storage";
import { LINE_HEIGHT_MULTIPLIER } from "./textLayout";
import type { Memo, MemoStyle, Point, Stroke, TextMemo } from "./types";

function makeId(): string {
  return `memo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_UNDO_HISTORY = 50;
const DEFAULT_CLAMP = (p: Point): Point => clampToRoundedRect(p, 1, 0.2);

/**
 * メモ全体の状態を保持し、既定ではlocalStorageと同期させるストア。
 * 保存・復元・全体リセットをまとめて担う。
 */
export class MemoStore {
  private memos: Memo[];
  private onChange?: (memos: readonly Memo[]) => void;
  private persistLocally: boolean;
  private undoStack: Memo[][] = [];
  private redoStack: Memo[][] = [];

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
   * これから始まる一連の操作（1回のドラッグでの描画・消去・移動、
   * または1回のテキスト編集セッション全体）の直前の状態を、undo履歴に積む。
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
   * メモ配列を丸ごと置き換える。置き換え前のundo/redo履歴は破棄する。
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

  /** 新しい手描きメモを1点で開始する（最初のストロークはこの直後に addPointToLastStroke で積む）。 */
  createMemo(
    start: Point,
    style: MemoStyle,
    now: number = Date.now(),
    originHalfExtent?: { halfW: number; halfH: number }
  ): Memo {
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
      ...(originHalfExtent ? { originHalfW: originHalfExtent.halfW, originHalfH: originHalfExtent.halfH } : {}),
    };
    this.memos.push(memo);
    this.persist();
    return memo;
  }

  /** 新しいテキストメモを作る。 */
  createTextMemo(
    anchor: Point,
    text: string,
    textLines: string[],
    fontSize: number,
    boxWidth: number,
    boxHeight: number,
    style: { color: string; align?: "center" | "left"; lineHeight?: number },
    now: number = Date.now(),
    originHalfExtent?: { halfW: number; halfH: number }
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
      ...(originHalfExtent ? { originHalfW: originHalfExtent.halfW, originHalfH: originHalfExtent.halfH } : {}),
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
   * 戻り値はメモ自体を削除したかどうか。
   */
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

  /** 既存のテキストメモの内容を書き換える。 */
  updateTextMemo(memoId: string, text: string, textLines: string[], boxWidth: number, boxHeight: number): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.kind !== "text" || memo.status !== "active") return;
    memo.text = text;
    memo.textLines = textLines;
    memo.boxWidth = boxWidth;
    memo.boxHeight = boxHeight;
    this.persist();
  }

  /** メモを1件削除する。 */
  deleteMemo(memoId: string): void {
    const before = this.memos.length;
    this.memos = this.memos.filter((m) => m.id !== memoId);
    if (this.memos.length !== before) {
      this.persist();
    }
  }

  /**
   * メモ全体（手描き・テキストどちらも）を (dx, dy) だけ平行移動する。
   * 描画可能領域の外にはみ出す移動はrestrictTranslationで制限する。
   */
  translateMemo(
    memoId: string,
    dx: number,
    dy: number,
    clamp: (p: Point) => Point = DEFAULT_CLAMP
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
      const corners = boxCorners({ x: memo.x, y: memo.y }, memo.boxWidth / 2, memo.boxHeight / 2);
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

  resetAll(): void {
    this.memos = [];
    this.undoStack = [];
    this.redoStack = [];
    this.persist();
  }

  /**
   * ウィンドウ縮小によって画面内へ引き寄せ表示されているメモを、移動・再編集の起点として
   * 現在の表示位置（基準座標＋offset）へ確定させ、originHalfW/Hも今のビューポートに更新する。
   */
  materializeDisplayOffset(
    memoId: string,
    dx: number,
    dy: number,
    originHalfExtent: { halfW: number; halfH: number }
  ): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.status !== "active") return;
    if (dx !== 0 || dy !== 0) {
      if (memo.kind === "stroke") {
        memo.strokes = memo.strokes.map((stroke) => stroke.map((p) => ({ x: p.x + dx, y: p.y + dy })));
      }
      memo.x += dx;
      memo.y += dy;
    }
    memo.originHalfW = originHalfExtent.halfW;
    memo.originHalfH = originHalfExtent.halfH;
    this.persist();
  }

  /**
   * 消しゴム: center から radius 以内をアクティブなメモから削除する。
   */
  eraseAt(center: Point, radius: number, getOffset?: (memo: Memo) => Point): boolean {
    let changed = false;
    this.memos = this.memos.filter((memo) => {
      if (memo.status !== "active") return true;
      const offset = getOffset ? getOffset(memo) : { x: 0, y: 0 };
      const localCenter = offset.x === 0 && offset.y === 0 ? center : { x: center.x - offset.x, y: center.y - offset.y };

      if (memo.kind === "text") {
        const touched = circleIntersectsBox(localCenter, radius, {
          x: memo.x,
          y: memo.y,
          width: memo.boxWidth,
          height: memo.boxHeight,
        });
        if (touched) changed = true;
        return !touched;
      }

      const newStrokes = memo.strokes.flatMap((s) => eraseFromStroke(s, localCenter, radius));
      const strokeCountChanged =
        newStrokes.length !== memo.strokes.length ||
        newStrokes.some((s, i) => s.length !== memo.strokes[i]?.length);
      if (strokeCountChanged) {
        changed = true;
        memo.strokes = newStrokes;
      }
      return memo.strokes.length > 0;
    });
    if (changed) {
      this.persist();
    }
    return changed;
  }
}
