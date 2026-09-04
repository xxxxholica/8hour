import { CircularCanvas } from "./canvasView";
import type { ToolState } from "./canvasView";
import { MemoStore } from "./memoStore";
import { measureTextBoxWidthPx, normalizedBoxSize, wrapTextAtReferenceScale } from "./textLayout";
import { PEN_LINE_WIDTH } from "./toolStyle";
import type { Memo, Point } from "./types";

const INK = "oklch(22% 0.012 55)";

/** .usage-guideモーダル自身のz-index(41、style.css)より前面に出すための値。
 *  「書く」手順のtext-editor-overlay専用（CircularCanvasOptions.textEditorZIndex
 *  参照）。 */
const TEXT_EDITOR_Z_INDEX = 45;

/** text-editor-overlayの画面上の幅の下限(px)。この練習用サンドボックスの円は
 *  本物よりひとまわり小さく（.tutorial-sandbox-canvas-wrap、style.css）、
 *  短いビューポート高さではさらに縮む（clamp(90px, ...)）ため、既定の幅計算
 *  だとタップ位置に対して極端に細い入力欄になり、1文字ごとに折り返されて
 *  縦に何行分も伸び、下の説明文と重なって見えてしまう（ユーザー報告：
 *  「メモするための円と説明文が重なってる」）。CircularCanvasOptions.
 *  textEditorMinWidthPx参照。 */
const TEXT_EDITOR_MIN_WIDTH_PX = 120;

/** canvasSizing.tsのMIN_CANVAS_SIZE(200px)を、この練習用サンドボックスに
 *  限って差し替える下限——.tutorial-sandbox-canvas-wrapのCSS側の下限
 *  （clamp(90px, ...)、style.css）と揃えてある。揃えないと、CSS側が90pxまで
 *  縮めたつもりでもcanvas要素の実サイズ計算（fitCanvasToContainer）が
 *  本物と同じ200px下限のまま譲らず、canvas要素がコンテナからはみ出して
 *  下の説明文と重なって見えてしまう。 */
const MIN_CANVAS_SIZE_PX = 90;

/** 練習用の円では、入力時のプレースホルダー（最小16px）と確定後のメモが
 *  同じ大きさに見えるよう、通常のlargeより少し大きい基準値を使う。 */
const TUTORIAL_FONT_SIZE = 36;

type StepId = "write" | "erase" | "done";
const STEP_ORDER: StepId[] = ["write", "erase", "done"];

const MESSAGES: Record<StepId, string> = {
  write: "円をタップするか、そのままキー入力して、思いついたことを新しく書いてみましょう。",
  erase: "消したいメモを消しゴムでなぞって消してみましょう。手を出さなければ、そのまま残り続けます。",
  done: "何もしなければ消えない、汚くていい作業台。自由に書いてみてください。",
};

/** 見出し（usageGuide.tsのbuildPracticePageが表示するタイトル）を、今の
 *  手順の内容に合わせて短い動詞で言い換える。onStepTitle経由でusageGuide.tsへ
 *  渡す。 */
const STEP_TITLES: Record<StepId, string> = {
  write: "書き込む",
  erase: "メモを消す",
  done: "円相",
};

/**
 * 使い方ページ（usageGuide.ts）の中間パートで使う、体験専用のサンドボックス。
 * 本物のCircularCanvas/MemoStoreとは完全に別の使い捨てインスタンスを持ち、
 * 自前のrequestAnimationFrameで駆動する——本物のインスタンスは外から
 * render()を呼び続けないと何も描かれないため。
 *
 * ポインタ操作（pointerdown/move/leave）はこのインスタンス自身のcanvas要素に
 * 閉じたリスナーのため、使い方ページの全画面オーバーレイが背後の本物の
 * キャンバスを覆っている間は本物には一切届かない。
 *
 * 「書く」手順だけは本物のテキスト入力（道具を"text"にしてタップ→
 * canvasView.tsのopenTextEditor）を使う。それ以外の手順ではキー入力を
 * 一切必要としないため、使い方ページ側（usageGuide.ts）がwindow単位の
 * keydownをcapture段でstopPropagationして本物のonGlobalKeyDown
 * （ブラインドタイピング）に渡さないようにしているが、「書く」手順で
 * このサンドボックス自身のtext-editor-overlay（.text-editor-overlay）に
 * フォーカスがある間だけは例外的に素通しする——それでも本物へブラインド
 * タイピングが漏れないのは、本物のonGlobalKeyDownがdocument.activeElementが
 * テキストエリアの間は横取りしないという既存のガードにそのまま守られる
 * ため。詳しくはusageGuide.tsのonKeyDown参照。
 */
export class TutorialSandbox {
  private canvasWrap: HTMLElement;
  private messageEl: HTMLElement;
  private nextBtn: HTMLButtonElement;
  /** 全手順を終えた（スキップ含む）瞬間に一度だけ呼ばれる。使い方ページ
   *  （usageGuide.ts）がページ送りで次の「結」画面へ進めるためのフック。 */
  private onComplete: (() => void) | null;
  /** 手順が変わるたびSTEP_TITLES[step]を渡して呼ばれる。usageGuide.tsが
   *  練ページの見出し（マーカー隣のタイトル）を差し替えるためのフック。 */
  private onStepTitle: ((title: string) => void) | null;

  private store: MemoStore | null = null;
  private canvasView: CircularCanvas | null = null;

  private raf = 0;
  private running = false;

  private step: StepId = "write";
  /** 「書く」手順の完了検出用：seed()で置いた添え物のidをあらかじめ入れておき、
   *  store.getAll()にこれ以外のidが現れたら「ユーザーが新しく書いた」と判定する
   *  （内容は問わない）。 */
  private knownMemoIds = new Set<string>();
  /** 「メモを消す」に入った瞬間の全メモID。このうちどれか1つでも消えたら達成。 */
  private eraseStartMemoIds: string[] = [];

  constructor(container: HTMLElement, onComplete?: () => void, onStepTitle?: (title: string) => void) {
    this.onComplete = onComplete ?? null;
    this.onStepTitle = onStepTitle ?? null;
    container.className = "tutorial-sandbox";

    this.canvasWrap = document.createElement("div");
    this.canvasWrap.className = "tutorial-sandbox-canvas-wrap";

    this.messageEl = document.createElement("p");
    this.messageEl.className = "tutorial-sandbox-message";

    const actions = document.createElement("div");
    actions.className = "tutorial-sandbox-actions";
    this.nextBtn = document.createElement("button");
    this.nextBtn.type = "button";
    this.nextBtn.className = "pill-btn";
    this.nextBtn.textContent = "つぎへ";
    this.nextBtn.addEventListener("click", () => {
      if (this.step === "done") {
        this.onComplete?.();
        return;
      }
      const nextStep = STEP_ORDER[STEP_ORDER.indexOf(this.step) + 1];
      if (nextStep) this.advanceTo(nextStep);
    });
    actions.append(this.nextBtn);

    container.append(this.canvasWrap, this.messageEl, actions);
  }

  /** 使い方ページを開いている間だけ呼ぶ。開き直すたびにまっさらな状態から
   *  やり直せるよう、新しいストア・キャンバスを作り直す。 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.step = "write";
    this.syncStep();

    this.store = new MemoStore(undefined, false);
    this.canvasView = new CircularCanvas(this.canvasWrap, this.store, () => this.toolStateFor(), {
      minCanvasSizePx: MIN_CANVAS_SIZE_PX,
      // 「書く」手順で開くtext-editor-overlayは、既定z-index(20)のままだと
      // 使い方ページのモーダル自身（z-index 41）の背後に隠れてしまう
      // ——全画面モーダルは本来「本物のキャンバスの書きかけテキストを隠す」
      // 前提でtext-editor-overlayより手前に設計されているが、ここではその
      // モーダルの中で本物のテキスト入力を体験させたいので、逆に前面に出す。
      textEditorZIndex: TEXT_EDITOR_Z_INDEX,
      textEditorMinWidthPx: TEXT_EDITOR_MIN_WIDTH_PX,
      // 本体のスマホ表示は入力欄をキーボード直上へ固定するが、練習では
      // タップした場所と書き込まれる位置の対応が分かるよう円内へ重ねる。
      fixedBottomTextEditorOnCoarsePointer: false,
      minRenderedTextFontPx: 16,
    });
    this.seed();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** 使い方ページを閉じたら呼ぶ。CircularCanvasのwindow単位リスナー等を
   *  destroy()できちんと解除し、rAFも止める——開いたままrAFを回し続けると
   *  無駄に電力を使う（usageGuide.tsの挿絵アニメーションと同じ理由）。 */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvasView?.destroy();
    this.canvasView = null;
    this.store = null;
    this.knownMemoIds = new Set();
    this.eraseStartMemoIds = [];
  }

  /** 「書く」手順だけテキスト道具、それ以外は消しゴム——このサンドボックスで
   *  体験させたい操作を、書く・消すの2つに絞る（道具バー自体は持たない）。 */
  private toolStateFor(): ToolState {
    return {
      tool: this.step === "write" ? "text" : "eraser",
      color: INK,
      fontSize: TUTORIAL_FONT_SIZE,
      lineWidth: PEN_LINE_WIDTH,
      eraserRadius: 16,
    };
  }

  /** 「書く」手順の前に、添え物を1枚だけ仕込んでおく——「メモを消す」手順で
   *  触る対象を用意しておく。 */
  private seed(): void {
    if (!this.store) return;
    const measureCtx = document.createElement("canvas").getContext("2d")!;
    const ambient = seedTextThought(measureCtx, this.store, { x: -0.25, y: 0.5 }, "夢の続き");
    this.knownMemoIds = new Set([ambient.id]);
  }

  private loop = (): void => {
    if (!this.running || !this.store || !this.canvasView) return;
    this.canvasView.render();
    this.checkProgress();
    this.raf = requestAnimationFrame(this.loop);
  };

  private checkProgress(): void {
    if (!this.store) return;
    const memos: readonly Memo[] = this.store.getAll();
    if (this.step === "write") {
      // 内容は問わず、seed()で置いた添え物に無い新しいidが現れたら
      // 「ユーザーが書き終えた」と判定する（canvasView.tsのopenTextEditorが
      // blur時にstore.createTextMemoを呼ぶタイミングを直接コールバックで
      // 拾う手段が無いため、ストアをポーリングして検出する）。
      const newMemo = memos.find((m) => !this.knownMemoIds.has(m.id));
      if (newMemo) {
        this.knownMemoIds.add(newMemo.id);
        // Enterで入力を確定しただけで次の説明へ飛ばさず、ほかの手順と同じく
        // 本人が「つぎへ」を押してから進む。
        this.nextBtn.hidden = false;
      }
    } else if (this.step === "erase") {
      const erased = this.eraseStartMemoIds.some((id) => !memos.some((memo) => memo.id === id));
      if (this.nextBtn.hidden && erased) {
        this.nextBtn.hidden = false;
      }
    }
  }

  /** 手順を先に進める（後戻りはしない）。 */
  private advanceTo(step: StepId): void {
    if (STEP_ORDER.indexOf(step) <= STEP_ORDER.indexOf(this.step)) return;
    this.step = step;
    if (step === "erase") {
      this.eraseStartMemoIds = (this.store?.getAll() ?? []).map((m) => m.id);
    }
    this.syncStep();
  }

  private syncStep(): void {
    this.messageEl.textContent = MESSAGES[this.step];
    this.nextBtn.textContent = this.step === "done" ? "はじめる" : "つぎへ";
    this.nextBtn.hidden = this.step !== "done";
    this.onStepTitle?.(STEP_TITLES[this.step]);
  }

  /** 使い方モーダルのcapture段から、直接キー入力を通してよい状態かを返す。 */
  isWritingStep(): boolean {
    return this.running && this.step === "write";
  }

  startDirectTextInput(initialText: string): void {
    if (!this.isWritingStep()) return;
    this.canvasView?.startTextInputAtCenter(initialText);
  }
}

/** 短い「思いつき」のテキストメモを仕込む。 */
function seedTextThought(
  measureCtx: CanvasRenderingContext2D,
  store: MemoStore,
  center: Point,
  text: string
): Memo {
  const fontSize = TUTORIAL_FONT_SIZE;
  const boxWidthPx = measureTextBoxWidthPx(measureCtx, text, fontSize);
  const textLines = wrapTextAtReferenceScale(measureCtx, text, fontSize, boxWidthPx);
  const { width, height } = normalizedBoxSize(fontSize, textLines.length, boxWidthPx);
  return store.createTextMemo(center, text, textLines, fontSize, width, height, { color: INK });
}
