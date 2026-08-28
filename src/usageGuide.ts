import { createFadeVisibility } from "./fadeVisibility";
import { markUsageGuideSeen } from "./storage";
import { TutorialSandbox } from "./tutorialSandbox";

/**
 * 使い方ページ：円相の由来と基本操作を、序・練の2画面をページ送りで見せる
 * 全画面モーダル。1画面につき1ページで、スクロールでたどる必要はない
 * （ユーザー指示）——序で「つぎへ」を押すと練が始まり、練の中はさらに
 * 書く・みる・残す・消す・振り返るの5手順を、実際の操作（書き終える・
 * ジェスチャーの成功）で順に進み、最後の「円相」を結びとしてそのまま閉じる。序は
 * 読み物のまま、「練」だけは本物のCircularCanvasを再利用した練習用
 * サンドボックス（tutorialSandbox.ts）——書く・掴んで回す・振り返り
 * スライダーという、このアプリ特有の操作を実際に手を動かして体験できる。
 *
 * 以前は本物のキャンバス・本物のstoreをそのまま流用してチュートリアルにしていたが、
 * ①本物のCircularCanvasは外からrequestAnimationFrameでrender()を呼び続けないと
 * 何も描かれない、②裏に隠れているだけの本物のキャンバスがwindow単位の
 * ブラインドタイピングを拾って実データに書き込んでしまう、といった不具合が
 * 繰り返し起き、実装・保守のコストがリターンに見合わなくなったため一度撤廃した
 * （読み物だけの静的ページに置き換えた経緯）。今回の「練」は、この2つの不具合を
 * 構造的に防げる形で作り直したもの——CircularCanvasクラス自体は再利用しつつ、
 * 専用の使い捨てMemoStore・自前のrequestAnimationFrameループを持たせ（①の対策）。
 * ②の対策として、このページ自身がcapture段で全キー入力をstopPropagationして
 * 本物のonGlobalKeyDown（ブラインドタイピング）に渡さないが、「書く」手順で
 * 使うサンドボックス自身のテキスト編集（.text-editor-overlay）にフォーカスが
 * ある間だけは例外的に素通しする——それでも本物へ漏れないのは、本物の
 * onGlobalKeyDown自体が「document.activeElementが他の入力欄の間は横取りしない」
 * という既存のガードを持つため。詳しくはonKeyDown・tutorialSandbox.tsの
 * クラスコメント参照。
 *
 * 全画面モーダルの骨格・フォーカスの作法はtemplatePicker.tsに揃える。
 * Escapeキーを含む全キー入力を（上記の「書く」手順の例外を除いて）capture段で
 * stopPropagationするのもtemplatePicker.tsと同じ理由——このページ自身は
 * 「書く」手順以外のテキスト入力を一切持たないため、安全に止められる。
 */

interface Stage {
  marker: string;
  title: string;
  body: string;
  anim: "intro" | "close";
}

const INTRO_STAGE: Stage = {
  marker: "序",
  title: "円相（えんそう）",
  anim: "intro",
  body: "円相は、円の中に思いつきを書き留めるメモアプリです。メモは時間とともに薄れ、やがて消えていきます。残したいものに触れて時間を戻し、今の自分に大切なものを選び直す。その姿を、一筆で生まれる禅の書画「円相」に重ねています。",
};

let overlay: UsageGuide | null = null;

/** onCloseは、閉じた（スキップ含む）直後に一度だけ呼ばれる——初回だけこの後に
 *  テンプレート選択へ続けるため（main.ts参照）。ヘッダーからの再視聴時は省略する。
 *  showSkipは、序の画面に「早く使いたい」（そのまま閉じる）ボタンも並べて出すか
 *  ——初回起動時の自動表示だけtrueにする（main.ts）。設定メニューからの
 *  再視聴（settingsMenu.ts）はfalse（既定）のまま、「使い方を見る」だけにする
 *  （ユーザー指示）。 */
export function openUsageGuide(onClose?: () => void, showSkip = false): void {
  if (!overlay) overlay = new UsageGuide();
  overlay.open(onClose, showSkip);
}

class UsageGuide {
  private root: HTMLElement;
  private sheet: HTMLElement;
  private setVisible: (show: boolean) => void;
  private opened = false;
  private lastFocused: HTMLElement | null = null;
  private canvases: HTMLCanvasElement[] = [];
  private raf = 0;
  private onClose: (() => void) | null = null;
  private sandbox: TutorialSandbox | null = null;
  /** 序の「早く使いたい」（そのまま閉じる）ボタン。open()のshowSkip引数に
   *  応じてhiddenを切り替える——buildIntroPageは1回しか呼ばれない
   *  （overlayはシングルトンで使い回す）ため、開くたびに出し分けるには
   *  要素自体は常に作っておき、都度hiddenだけ切り替える必要がある。 */
  private skipBtn: HTMLButtonElement | null = null;
  /** 序・練の2画面。1つだけhidden=falseにして、スクロールではなく
   *  ページ送りで切り替える（ユーザー指示）。 */
  private pages: HTMLElement[] = [];
  private pageIndex = 0;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "usage-guide fade-visible";
    this.root.hidden = true;
    this.root.addEventListener("pointerdown", (ev) => {
      if (ev.target === this.root) this.close();
    });

    this.sheet = document.createElement("section");
    this.sheet.className = "usage-guide-sheet";
    this.sheet.setAttribute("role", "dialog");
    this.sheet.setAttribute("aria-modal", "true");
    this.sheet.setAttribute("aria-label", "使い方");
    this.sheet.tabIndex = -1;
    this.root.appendChild(this.sheet);

    this.buildContent();

    this.setVisible = createFadeVisibility(this.root);
    document.body.appendChild(this.root);
  }

  private buildContent(): void {
    // ✕ボタンをheadの中に入れ、head自体は全ページ共通で常に上部に置く
    // （template-picker.tsのbuildHeadと同じ構成）。
    const head = document.createElement("header");
    head.className = "usage-guide-head";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "usage-guide-close";
    closeBtn.setAttribute("aria-label", "閉じる");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.close());

    head.append(closeBtn);
    this.sheet.appendChild(head);

    const pagesEl = document.createElement("div");
    pagesEl.className = "usage-guide-pages";
    this.pages = [this.buildIntroPage(), this.buildPracticePage()];
    this.pages.forEach((page, i) => {
      page.hidden = i !== 0;
      pagesEl.appendChild(page);
    });
    this.sheet.appendChild(pagesEl);
    this.syncSheetGlass();
  }

  /** ページ送りで次の画面へ進める（後戻りはしない——序/練は一方通行）。
   *  以前は1つの長いスクロールページに序・練・結を並べていたが、スクロール
   *  無しで1画面ずつ進めたいという指示のため、hidden属性の付け替えだけで
   *  切り替える単純なページ送りにした。 */
  private showPage(index: number): void {
    if (index === this.pageIndex || !this.pages[index]) return;
    this.pages[this.pageIndex].hidden = true;
    this.pageIndex = index;
    this.pages[index].hidden = false;
    this.syncSheetGlass();
    this.sheet.scrollTop = 0;
    this.sheet.focus();
  }

  /** 序（読み物の画面）は、背景（.usage-guide-sheet）を設定メニュー
   *  （.settings-popover）と同じすりガラスにする（ユーザー指示）。「練」は
   *  実際にペンで書く手順を含むため、下のキャンバスが透けて見えると紛らわしく
   *  誤操作の元になるので対象に含めない。 */
  private syncSheetGlass(): void {
    this.sheet.classList.toggle("usage-guide-sheet--glass", this.pageIndex === 0);
  }

  private buildIntroPage(): HTMLElement {
    const el = document.createElement("div");
    el.className = "usage-guide-page usage-guide-page--compact";
    el.appendChild(this.buildStageContent(INTRO_STAGE));

    const actions = document.createElement("div");
    actions.className = "usage-guide-page-actions";
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "pill-btn";
    nextBtn.textContent = "使い方を知りたい";
    // サンドボックスの仮想時計は、練の画面に実際に進んだ瞬間から動かし始める
    // ——モーダルを開いた時点で動かし始めると、序を読んでいる間（人によって
    // かかる時間が大きく違う）ぶん盤面が勝手に進んでしまう。
    nextBtn.addEventListener("click", () => {
      this.sandbox?.start();
      this.showPage(1);
    });
    actions.appendChild(nextBtn);

    // 初回起動時の自動表示だけ隣に出す「早く使いたい」（ユーザー指示）。
    // 既定はhidden——open()のshowSkip引数がtrueの間だけ見せる。
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "pill-btn";
    skipBtn.textContent = "早く使いたい";
    skipBtn.hidden = true;
    skipBtn.addEventListener("click", () => this.close());
    actions.appendChild(skipBtn);
    this.skipBtn = skipBtn;

    el.appendChild(actions);
    return el;
  }

  private buildPracticePage(): HTMLElement {
    const el = document.createElement("div");
    el.className = "usage-guide-page usage-guide-page--practice";

    const sandboxRoot = document.createElement("div");
    // 見出しのタイトルは固定文言ではなく、今の手順の内容に合わせて
    // 書き込む・眺める・巻き戻す・進める…と差し替える（ユーザー指示）
    // ——tutorialSandbox.tsのSTEP_TITLES/onStepTitle参照。
    const { el: heading, titleEl } = this.buildHeading("練", "");
    // サンドボックス側の最終画面「円相」で「はじめる」を押すとガイドを閉じる。
    // 独立した「結」ページは設けず、この練習結果をそのまま最後に見せる。
    this.sandbox = new TutorialSandbox(
      sandboxRoot,
      () => this.close(),
      (title) => (titleEl.textContent = title)
    );

    el.append(heading, sandboxRoot);
    return el;
  }

  /** 序の中身（マーカー・挿絵・タイトル・本文）。 */
  private buildStageContent(stage: Stage): HTMLElement {
    const el = document.createElement("div");
    el.className = "usage-guide-page-content";

    const canvas = document.createElement("canvas");
    canvas.className = "usage-guide-canvas";
    canvas.dataset.anim = stage.anim;
    this.canvases.push(canvas);

    const body = document.createElement("p");
    body.className = "usage-guide-stage-body";
    body.textContent = stage.body;

    const { el: heading } = this.buildHeading(stage.marker, stage.title);
    el.append(heading, canvas, body);
    return el;
  }

  /** マーカー（丸バッジ）とタイトルを横並びの見出し1行にまとめる——縦積みだと
   *  ウィンドウの高さによってはモーダル全体がスクロールを要するようになって
   *  しまっていた（ユーザー報告）ため、その分の高さを削っている。titleElも
   *  返すのは、練ページが手順ごとにタイトルの文言を差し替えるため
   *  （buildPracticePage参照）。 */
  private buildHeading(marker: string, title: string): { el: HTMLElement; titleEl: HTMLElement } {
    const el = document.createElement("div");
    el.className = "usage-guide-page-heading";

    const markerEl = document.createElement("div");
    markerEl.className = "usage-guide-marker";
    markerEl.textContent = marker;

    const titleEl = document.createElement("h3");
    titleEl.className = "usage-guide-stage-title";
    titleEl.textContent = title;

    el.append(markerEl, titleEl);
    return { el, titleEl };
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    // 「練」の「書く」手順だけは、本物のテキスト入力（tutorialSandbox.tsが
    // canvasView.tsのopenTextEditorを使って開く.text-editor-overlay）を
    // 使う。ここで素通しせずstopPropagationしてしまうと、日本語IME変換は
    // おろか通常のタイピング・Enter確定・Escape取り消しまで一切効かなく
    // なってしまう——本物のonGlobalKeyDown（ブラインドタイピング）へ漏れる
    // 心配が無いのは、そちら側にdocument.activeElementがテキストエリアの
    // 間は横取りしないという既存のガードが既にあるため（他の入力欄に
    // フォーカスがある間は横取りしないためのもの、canvasView.ts参照）。
    if (ev.target instanceof HTMLElement && ev.target.classList.contains("text-editor-overlay")) {
      return;
    }
    // 練習の「書き込む」では、本体と同じく印字可能なキーから直接入力を始める。
    // capture段で止めず、CircularCanvas.onGlobalKeyDownまで伝播させる。
    if (
      this.pageIndex === 1 &&
      this.sandbox?.isWritingStep() &&
      !ev.ctrlKey &&
      !ev.metaKey &&
      !ev.altKey &&
      ev.key.length === 1
    ) {
      ev.preventDefault();
      ev.stopPropagation();
      this.sandbox.startDirectTextInput(ev.key);
      return;
    }
    ev.stopPropagation();
    if (ev.key === "Escape") this.close();
  };

  open(onClose?: () => void, showSkip = false): void {
    if (this.opened) return;
    this.opened = true;
    this.onClose = onClose ?? null;
    if (this.skipBtn) this.skipBtn.hidden = !showSkip;
    // 開いた時点で「既読」にする——個人キャンバスの案内ボタン（main.ts）は
    // これを見て、一度でも開けば以後出さなくなる。
    markUsageGuideSeen();
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 開き直すたびに序へ戻す——前回結まで進んでいても、次に開いた時は
    // 最初からやり直せるように。
    this.showPage(0);
    this.setVisible(true);
    window.addEventListener("keydown", this.onKeyDown, true);
    requestAnimationFrame(() => this.sheet.focus());
    this.startAnimations();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.setVisible(false);
    this.stopAnimations();
    this.sandbox?.stop();
    this.lastFocused?.focus();
    this.lastFocused = null;
    const onClose = this.onClose;
    this.onClose = null;
    onClose?.();
  }

  /** 挿絵は開いている間だけ動かす（閉じている間にrequestAnimationFrameを
   *  回し続けて無駄に電力を使わないため）。 */
  private startAnimations(): void {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const states = this.canvases.map((canvas) => ({ canvas, ctx: fitCanvas(canvas), start: 0 }));
    const loop = (ts: number) => {
      for (const s of states) {
        if (s.start === 0) s.start = ts;
        drawStageAnim(s.ctx, s.canvas.dataset.anim as Stage["anim"], ts - s.start, reduceMotion);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopAnimations(): void {
    cancelAnimationFrame(this.raf);
  }
}

function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 96;
  const h = rect.height || 96;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function guideInkColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--ink-solid").trim() || "oklch(22% 0.012 55)";
}

/** 一筆書きの円相を、生成的な筆致（太さのむら・わずかな歪み）で描く
 *  （tutorial/tutorialCanvas.tsで使っていたのと同じ数式）。 */
function strokeEnso(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  sweepDeg: number,
  opacity: number,
  color: string,
  seed: number
): void {
  const segments = 48;
  const startRad = (startDeg * Math.PI) / 180;
  const sweepRad = (sweepDeg * Math.PI) / 180;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const a0 = startRad + sweepRad * t0;
    const a1 = startRad + sweepRad * t1;
    const mid = (t0 + t1) / 2;
    const pressure = Math.sin(Math.PI * Math.min(mid * 1.08, 1));
    const wobble = 1 + 0.06 * Math.sin((mid * 37 + seed) * 6.283);
    ctx.lineWidth = (1.4 + pressure * 4) * wobble;
    ctx.beginPath();
    ctx.arc(cx, cy, r + Math.sin(mid * 23 + seed) * 1.2, a0, a1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStageAnim(ctx: CanvasRenderingContext2D, kind: Stage["anim"], t: number, reduceMotion: boolean): void {
  const w = ctx.canvas.width / (window.devicePixelRatio || 1);
  const h = ctx.canvas.height / (window.devicePixelRatio || 1);
  if (w === 0 || h === 0) return;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.34;
  const ink = guideInkColor();

  if (kind === "intro") {
    const p = reduceMotion ? 1 : Math.min(1, t / 2200);
    const eased = 1 - (1 - p) ** 3;
    strokeEnso(ctx, cx, cy, r, -100, 328 * eased, 1, ink, 1);
  } else if (kind === "close") {
    strokeEnso(ctx, cx, cy, r, -95, 342, 1, ink, 7);
  }
}
