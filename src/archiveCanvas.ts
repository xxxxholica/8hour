import { FrameGeometry } from "./frameGeometry";
import { circleIntersectsBox, pointNearStrokes } from "./geometry";
import { renderMemoAt } from "./memoRenderer";
import { drawRuledPaper } from "./paper";
import type { Memo, Point } from "./types";

/** hitTestと同じ許容範囲（canvasView.tsのHIT_THRESHOLD_PXと同じ考え方）。 */
const HIT_THRESHOLD_PX = 12;
/** ドラッグ中に指・カーソルへ追従させる、掴んだメモのプレビューの一辺(px)。 */
const DRAG_GHOST_SIZE_PX = 120;
const DRAG_GHOST_PADDING_PX = 16;

export interface ArchiveCanvasOptions {
  minCanvasSizePx?: number;
  contentScaleFactor?: number | ((size: number) => number);
  /** メモを掴んでドラッグを始めた瞬間に呼ぶ。 */
  onDragStart?: () => void;
  /** ドラッグ中、ポインタが動くたびに画面座標を渡す。呼び出し側（main.ts）が
   *  ドロップ帯の上に乗っているかどうかを判定し、ホバー状態の見た目を
   *  切り替えるために使う。 */
  onDragMove?: (clientX: number, clientY: number) => void;
  /** ドラッグを離した瞬間に、掴んでいたメモ（アーカイブ側の元データ。この
   *  クラス自身は一切変更しない）と、離した瞬間の画面座標を渡す。有効な
   *  ドロップ先（ドロップ帯の上かどうか）の判定は呼び出し側（main.ts）に
   *  委ねる。 */
  onDrop?: (memo: Memo, clientX: number, clientY: number) => void;
}

/**
 * 過去めくり画面（main.ts）の左側に表示する、読み取り専用のアーカイブ
 * ビュー。CircularCanvas（手描き・消しゴム・undo・ズーム・テキスト編集を
 * 抱えた大きなクラス）は流用せず、「アーカイブされたメモを描画する」
 * 「掴んでドラッグして持ち出す」だけに絞った軽量な専用クラスとして実装する。
 * 描画中のメモ配列そのものは一切書き換えない——ドラッグは「覗いて複製を
 * 持ち出す」操作であって、移動ではない。
 */
export class ArchiveCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = Math.max(1, window.devicePixelRatio || 1);
  private container: HTMLElement;
  private frame: FrameGeometry;
  private resizeObserver: ResizeObserver;
  private memos: readonly Memo[];
  private options: ArchiveCanvasOptions;

  private draggingMemo: Memo | null = null;
  private draggingPointerId: number | null = null;
  private dragGhostWrap: HTMLDivElement | null = null;

  constructor(container: HTMLElement, memos: readonly Memo[], options: ArchiveCanvasOptions = {}) {
    this.container = container;
    this.memos = memos;
    this.options = options;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "archive-canvas";
    this.container.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context is not available");
    this.ctx = ctx;

    this.frame = new FrameGeometry(this.canvas, this.container, this.dpr, {
      contentScaleFactor: options.contentScaleFactor,
      minCanvasSizePx: options.minCanvasSizePx,
    });

    this.resizeObserver = new ResizeObserver(() => this.frame.resize());
    this.resizeObserver.observe(this.container);

    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
  }

  /** 表示中の日付を切り替える（インスタンスは使い回す）。 */
  setMemos(memos: readonly Memo[]): void {
    this.memos = memos;
  }

  private toNormalized(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.frame.centerPx.x) / this.frame.scale,
      y: (clientY - rect.top - this.frame.centerPx.y) / this.frame.scale,
    };
  }

  /** CircularCanvasのhitTestMemoと同じ考え方（pointNearStrokes/circleIntersectsBox）。 */
  private hitTest(p: Point): Memo | null {
    const threshold = HIT_THRESHOLD_PX / this.frame.scale;
    for (const memo of this.memos) {
      if (memo.status !== "active") continue;
      if (memo.kind === "stroke") {
        if (pointNearStrokes(p, memo.strokes, threshold)) return memo;
      } else if (
        circleIntersectsBox(p, threshold, { x: memo.x, y: memo.y, width: memo.boxWidth, height: memo.boxHeight })
      ) {
        return memo;
      }
    }
    return null;
  }

  private boundingBoxOf(memo: Memo): { minX: number; minY: number; maxX: number; maxY: number } {
    if (memo.kind === "stroke") {
      const points = memo.strokes.flat();
      if (points.length === 0) return { minX: memo.x, minY: memo.y, maxX: memo.x, maxY: memo.y };
      return {
        minX: Math.min(...points.map((p) => p.x)),
        minY: Math.min(...points.map((p) => p.y)),
        maxX: Math.max(...points.map((p) => p.x)),
        maxY: Math.max(...points.map((p) => p.y)),
      };
    }
    return {
      minX: memo.x - memo.boxWidth / 2,
      minY: memo.y - memo.boxHeight / 2,
      maxX: memo.x + memo.boxWidth / 2,
      maxY: memo.y + memo.boxHeight / 2,
    };
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (this.draggingMemo) return; // 既に1件ドラッグ中なら別の指は無視する
    const hit = this.hitTest(this.toNormalized(ev.clientX, ev.clientY));
    if (!hit) return;
    ev.preventDefault();
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      // ブラウザ差異等でcaptureに失敗しても致命的ではないため無視する。
    }
    this.draggingMemo = hit;
    this.draggingPointerId = ev.pointerId;
    this.options.onDragStart?.();
    this.buildDragGhost(hit, ev.clientX, ev.clientY);
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.draggingMemo || ev.pointerId !== this.draggingPointerId) return;
    this.positionDragGhost(ev.clientX, ev.clientY);
    this.options.onDragMove?.(ev.clientX, ev.clientY);
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (!this.draggingMemo || ev.pointerId !== this.draggingPointerId) return;
    const memo = this.draggingMemo;
    const clientX = ev.clientX;
    const clientY = ev.clientY;
    this.draggingMemo = null;
    this.draggingPointerId = null;
    this.removeDragGhost();
    this.options.onDrop?.(memo, clientX, clientY);
  };

  /** 掴んだメモの見た目を、指・カーソルに追従する小さなプレビューとして
   *  画面固定(position:fixed)のオーバーレイに描く——本体のアーカイブ表示
   *  （this.memos）はドラッグ中も一切変更しない。 */
  private buildDragGhost(memo: Memo, clientX: number, clientY: number): void {
    const bbox = this.boundingBoxOf(memo);
    const bw = Math.max(bbox.maxX - bbox.minX, 0.05);
    const bh = Math.max(bbox.maxY - bbox.minY, 0.05);
    const available = DRAG_GHOST_SIZE_PX - DRAG_GHOST_PADDING_PX * 2;
    const radius = Math.min(available / bw, available / bh);
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;

    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = DRAG_GHOST_SIZE_PX * this.dpr;
    previewCanvas.height = DRAG_GHOST_SIZE_PX * this.dpr;
    previewCanvas.style.width = `${DRAG_GHOST_SIZE_PX}px`;
    previewCanvas.style.height = `${DRAG_GHOST_SIZE_PX}px`;
    const pctx = previewCanvas.getContext("2d")!;
    pctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    pctx.translate(DRAG_GHOST_SIZE_PX / 2 - centerX * radius, DRAG_GHOST_SIZE_PX / 2 - centerY * radius);
    renderMemoAt(pctx, memo, radius, 1);

    const wrap = document.createElement("div");
    wrap.className = "history-drag-ghost";
    wrap.appendChild(previewCanvas);
    document.body.appendChild(wrap);
    this.dragGhostWrap = wrap;
    this.positionDragGhost(clientX, clientY);
  }

  private positionDragGhost(clientX: number, clientY: number): void {
    if (!this.dragGhostWrap) return;
    this.dragGhostWrap.style.left = `${clientX}px`;
    this.dragGhostWrap.style.top = `${clientY}px`;
  }

  private removeDragGhost(): void {
    this.dragGhostWrap?.remove();
    this.dragGhostWrap = null;
  }

  render(): void {
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w / this.dpr, h / this.dpr);
    ctx.translate(this.frame.centerPx.x, this.frame.centerPx.y);

    const shape = this.frame.currentShape();
    const r = this.frame.scale;

    // 枠線は撤去し、CSSのdrop-shadow（.archive-canvas、style.css）で紙の輪郭に
    // 沿って浮かせる見た目に置き換えた（ユーザー指示）——ここでは紙以外
    // 何も塗らない。
    ctx.save();
    ctx.clip(this.frame.framePath);
    drawRuledPaper(ctx, r, r * shape.maxReach);
    for (const memo of this.memos) {
      if (memo.status !== "active") continue;
      renderMemoAt(ctx, memo, r, 1);
    }
    ctx.restore(); // clip

    ctx.restore(); // translate + setTransform
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.removeDragGhost();
    this.canvas.remove();
  }
}
