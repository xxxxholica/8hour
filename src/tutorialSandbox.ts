import { CircularCanvas } from "./canvasView";
import type { ToolState } from "./canvasView";
import { createFadeVisibility } from "./fadeVisibility";
import { FIXED_LIFESPAN_DAYS, MS_PER_DAY } from "./fade";
import { MemoStore } from "./memoStore";
import { RewindSelector } from "./rewindSelector";
import { ReviveInfoPill } from "./reviveInfoPill";
import { measureTextBoxWidthPx, normalizedBoxSize, wrapTextAtReferenceScale } from "./textLayout";
import { PEN_LINE_WIDTH } from "./toolStyle";
import type { LifespanDays, Memo, Point } from "./types";

const INK = "oklch(22% 0.012 55)";
const HOUR = 60 * 60 * 1000;

/** 仮想時計の進み方（実時間1msに対して盤面上の時間が何ms進むか）。本物の
 *  寿命（1日、FIXED_LIFESPAN_DAYS）を数十秒〜数分で体験できるよう加速する。
 *  以前は400だったが、「振り返り」の目盛りに対してどれだけ経過したかが
 *  ユーザーが手順を終えるまでにかかった実時間（人によって大きくばらつく）
 *  に敏感すぎ、振り返っても対象が見つからない／既に完全に消えてしまっている
 *  ことがあった（ユーザー報告）。「見ている間にも自然に薄れていく」という
 *  一手順目の体感速度だけの調整値として、控えめな値に下げてある——ただし
 *  「眺める」手順で1枚が完全に消えきるところまで見せる分には、この程度の
 *  加速ではまだ実時間24分もかかってしまうため足りない（下のWATCH_DEMO_*
 *  参照、そちらは専用のもっと短い寿命へ一時的に差し替えて解決している。
 *  "watch"を出た後は必ずfreezeToRealPaceで本物の寿命へ戻すため、以後は
 *  この控えめな加速の恩恵をそのまま受けられる）。 */
const VIRTUAL_ACCEL = 60;

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
 *  下の説明文と重なって見えてしまう（ユーザー報告：「メモするための円と
 *  説明文が重なってる」——真の原因はここで、text-editor-overlayの幅
 *  （TEXT_EDITOR_MIN_WIDTH_PX）だけでは直らなかった）。 */
const MIN_CANVAS_SIZE_PX = 90;

/** 練習用の円では、入力時のプレースホルダー（最小16px）と確定後のメモが
 *  同じ大きさに見えるよう、通常のlargeより少し大きい基準値を使う。 */
const TUTORIAL_FONT_SIZE = 36;

/** 「眺める」手順専用: 盤面の3枚全部（添え物2枚＋「書く」手順でユーザーが
 *  書いた1枚）が、この手順の待ち時間のうちに薄れていく様子を見せる
 *  （ユーザー指示：「書き込みが全部薄くなるといいかも」——当初はambient
 *  1枚だけだったが、他の2枚も本物の寿命（FIXED_LIFESPAN_DAYS、1日）の
 *  ままだと、VIRTUAL_ACCELで60倍してもこの手順の間（数秒〜十数秒）では
 *  見た目がまったく変わらない）。ただし添え物2枚（ambient・decoy）と
 *  「書く」手順の1枚はこの後の「残す/手放す」手順で掴む対象でもあるため、
 *  薄れきって掴めなくなる（reviveMemo/nudgeMemoClockは共にstatus==="active"
 *  の間しか効かない、memoStore.ts参照）と手順が進められなくなる恐れがある
 *  ——「つぎへ」が押せるようになる瞬間（syncNextBtnVisibility→
 *  freezeToRealPace）に、その時点でまだ生きているものだけ本物の寿命へ
 *  切り替える。「眺める」を出た後は"watch"の短い寿命に戻ることは無い
 *  （＝以後ずっと安全）。既に消えきったものはそのまま消えたまま——
 *  「眺める」の間に本当に手を出せなかったものは戻さない（ユーザー指示：
 *  「眺めるの部分を除いて、チュートリアルメモの状態は引き継ぐように」）。 */
const WATCH_DEMO_FADE_REAL_MS = 10_000;
/** 上のWATCH_DEMO_FADE_REAL_MSを、実際に寿命として使えるlifespanDays（日数）に
 *  換算したもの——VIRTUAL_ACCELで割るのではなく掛けているのは、
 *  「経過した仮想ms = 経過した実ms × VIRTUAL_ACCEL」（currentVirtualNow参照）
 *  だからで、実時間WATCH_DEMO_FADE_REAL_MSぶんで寿命を使い切らせるには
 *  寿命の総量（仮想ms）をその分だけ短く設定する必要があるため。 */
const WATCH_DEMO_LIFESPAN_DAYS: LifespanDays = (WATCH_DEMO_FADE_REAL_MS * VIRTUAL_ACCEL) / MS_PER_DAY;
const WATCH_DEMO_TOTAL_VIRTUAL_MS = WATCH_DEMO_LIFESPAN_DAYS * MS_PER_DAY;
/** 添え物2枚（ambient・decoy、reseedForWatchDemo参照）のバックデートは、
 *  あえて2枚で違う値にしてある——「全部が同時に同じ濃さで薄れて消える」と
 *  見た目が単調な一斉フェードになってしまい、「時間の経ち方は一律ではない」
 *  という一手順目で伝えたいことと逆行してしまう（ユーザー指摘：「ぜんぶ
 *  均一に薄くするべきではない」）。ambientは寿命の55%（fade.tsの
 *  computeOpacityでいう60%→20%の境目3/7≒0.43を過ぎた「かなり薄い」状態）
 *  から始めて比較的早く消えきり、decoyは20%（100%→60%の境目1/7≒0.14を
 *  少し過ぎただけの「まだ濃い」状態）から始めてゆっくり薄れる——「書く」
 *  手順でユーザーが書いた1枚は書いたその瞬間（経過0、最も濃い）から
 *  WATCH_DEMO_LIFESPAN_DAYSで薄れ始める（toolStateFor参照）ため、この3枚
 *  それぞれ違うタイミング・違う速さで薄れていく様子になる。 */
const WATCH_AMBIENT_BACKDATE_MS = WATCH_DEMO_TOTAL_VIRTUAL_MS * 0.55;
const WATCH_DECOY_BACKDATE_MS = WATCH_DEMO_TOTAL_VIRTUAL_MS * 0.2;
/** 「つぎへ」を"watch"手順に入って即座にではなく、この時間だけ待たせてから
 *  出す（ユーザー指示：消える様子を見れるように、しばらくしてから表示する）。
 *  一番遅く消えきるdecoy（バックデート20%ぶんを引いた残り80%、実時間8秒）
 *  より長めに取り、3枚それぞれ違うタイミングで薄れ消えていく様子を
 *  見届けられる余裕を持たせてある。 */
const WATCH_NEXT_BTN_DELAY_MS = 9_000;

/** freezeToRealPaceの中で、「つぎへ」が押せるようになる瞬間までに既に
 *  完全に消えきっていた（status!=="active"）ものを復活させる際のバック
 *  デート。seed()の元々のdecoyのバックデートと同じ値——真っ白より少し
 *  薄れかけている方が「時間が経つと薄れる」という前提が伝わりやすい、
 *  という元々の意図をそのまま踏襲している。ユーザー報告：「眺めるの
 *  部分で全部消えてしまってそのままなので一向に進めない」——消えた
 *  ままだと「残す/手放す」で掴める対象が無くなり手順が進められなく
 *  なってしまうため、この一度きり位置・文面を保ったまま復活させる
 *  （ユーザー指示：「一度そこで復活させてほしい。位置は保持する
 *  前提で」）。 */
type StepId = "write" | "watch" | "keep" | "erase" | "rewind" | "done";
const STEP_ORDER: StepId[] = ["write", "watch", "keep", "erase", "rewind", "done"];

const MESSAGES: Record<StepId, string> = {
  write: "円をタップするか、そのままキー入力して、思いついたことを新しく書いてみましょう。",
  watch: "ほかにも、いくつか思いつきが置いてあります。何もしなければ、自然に薄れて消えていきます。少し眺めてみましょう。",
  keep: "残したい一枚に触れたまま、指で円を描くように反時計回りに回してみてください。時間が巻き戻り、また留まります。",
  erase: "消したいメモを指やマウスでなぞってみましょう。消しゴムなら、待たずにその場で消せます。",
  rewind: "下のスライダーを動かして、少し前の盤面を振り返ってみましょう。",
  done: "全部は残せません。だからこそ、そうやって選び続けた一枚には意味があります。",
};

/** 見出し（usageGuide.tsのbuildPracticePageが表示するタイトル）を、今の
 *  手順の内容に合わせて短い動詞で言い換える（ユーザー指示：「手を動かして
 *  みましょう」という固定文言ではなく、書き込む・眺める・巻き戻す・進める
 *  のように手順ごとの見出しにしたい）。onStepTitle経由でusageGuide.tsへ
 *  渡す。 */
const STEP_TITLES: Record<StepId, string> = {
  write: "書き込む",
  watch: "メモは消える",
  keep: "メモを残す",
  erase: "メモを消す",
  rewind: "振り返る",
  done: "円相",
};

/** 掴んで回す対象の追跡用。lastTracedAtは移動道具の振り回し操作
 *  （nudgeMemoClock、canvasView.ts）でしか変化しないため、seed時の値からの
 *  増減を見るだけで「反時計回りに回した／時計回りに回した」を正確に検出できる
 *  ——受動的な経時フェード（tick）はlastTracedAtを一切書き換えないので、
 *  放置による自然消滅と誤検知することもない。「残したい一枚」がどれかは
 *  指示文で特定していない（3枚とも見た目上は対等）ため、判定は3枚のうち
 *  どれか1枚ぶんでも条件を満たせば成立させる——特定の1枚だけを見ていると、
 *  ユーザーが別の1枚を回した時に「実際に巻き戻っているのに手順が進まない」
 *  ことになる（ユーザー報告）。 */
interface TrackedMemo {
  id: string;
  initialLastTracedAt: number;
}

/**
 * 使い方ページ（usageGuide.ts）の中間パートで使う、体験専用のサンドボックス。
 * 本物のCircularCanvas/MemoStoreとは完全に別の使い捨てインスタンスを持ち、
 * 自前のrequestAnimationFrameで駆動する——本物のインスタンスは外から
 * render()を呼び続けないと何も描かれないため（過去のインタラクティブ
 * チュートリアルが撤廃された理由の1つ）。
 *
 * ポインタ操作（pointerdown/move/leave）はこのインスタンス自身のcanvas要素に
 * 閉じたリスナーのため、使い方ページの全画面オーバーレイが背後の本物の
 * キャンバスを覆っている間は本物には一切届かない。window単位の
 * pointerup/pointercancelは意図的に横取りしていない：本物のonPointerUpは
 * 自身の状態がidleの間は何もしない（=このサンドボックスを操作している間、
 * 本物は必ずidleのまま）ため無害であり、かつこのサンドボックス自身の
 * ジェスチャー終了処理もwindow単位のpointerupに依存しているため、
 * window全体でstopPropagationするとこちらの操作まで巻き込んで壊れてしまう。
 *
 * 「書く」手順だけは本物のテキスト入力（道具を"text"にしてタップ→
 * canvasView.tsのopenTextEditor）を使う。それ以外の手順ではキー入力を
 * 一切必要としないため、使い方ページ側（usageGuide.ts）がwindow単位の
 * keydownをcapture段でstopPropagationして本物のonGlobalKeyDown
 * （ブラインドタイピング）に渡さないようにしているが、「書く」手順で
 * このサンドボックス自身のtext-editor-overlay（.text-editor-overlay）に
 * フォーカスがある間だけは例外的に素通しする——それでも本物へブラインド
 * タイピングが漏れないのは、本物のonGlobalKeyDownがdocument.activeElementが
 * テキストエリアの間は横取りしないという既存のガード（他の入力欄にフォーカスが
 * ある間は横取りしないためのもの）にそのまま守られるため。詳しくは
 * usageGuide.tsのonKeyDown参照。
 */
export class TutorialSandbox {
  private canvasWrap: HTMLElement;
  private messageEl: HTMLElement;
  private watchProgressWrap: HTMLElement;
  private watchProgressEl: HTMLProgressElement;
  private watchProgressLabel: HTMLElement;
  private rewindWrap: HTMLElement;
  private setRewindVisible: (show: boolean) => void;
  private nextBtn: HTMLButtonElement;
  /** 全手順を終えた（スキップ含む）瞬間に一度だけ呼ばれる。使い方ページ
   *  （usageGuide.ts）がページ送りで次の「結」画面へ進めるためのフック。 */
  private onComplete: (() => void) | null;
  /** 手順が変わるたびSTEP_TITLES[step]を渡して呼ばれる。usageGuide.tsが
   *  練ページの見出し（マーカー隣のタイトル）を差し替えるためのフック。 */
  private onStepTitle: ((title: string) => void) | null;

  private store: MemoStore | null = null;
  private canvasView: CircularCanvas | null = null;
  private rewindSelector: RewindSelector | null = null;
  private reviveInfoPill: ReviveInfoPill | null = null;

  private raf = 0;
  private running = false;
  private realStartMs = 0;
  private virtualBaseMs = 0;
  /** "watch"手順の「つぎへ」表示を遅らせるためのタイマー。syncStep()参照。 */
  private nextBtnTimer: ReturnType<typeof setTimeout> | null = null;

  private step: StepId = "write";
  /** seed()で置いた添え物＋「書く」手順でユーザー自身が書いたものの初期
   *  lastTracedAt。checkProgressはこの中のどれか1枚でも増減していれば
   *  keepを達成扱いにする。 */
  private memoBaselines: TrackedMemo[] = [];
  /** 「眺める」に入る直前の全メモ。復活時は寿命を含めてこの状態へ戻す。 */
  private watchStartMemos: Memo[] = [];
  private watchStartAt: number | null = null;
  /** 「メモを消す」に入る直前の状態。次へ進む際に消しゴム操作を取り消す。 */
  private eraseStartMemos: Memo[] = [];
  private eraseStartAt: number | null = null;
  /** 「書く」手順の完了検出用：seed()で置いた添え物のidをあらかじめ入れておき、
   *  store.getAll()にこれ以外のidが現れたら「ユーザーが新しく書いた」と判定する
   *  （内容は問わない）。 */
  private knownMemoIds = new Set<string>();
  /** seed()で置いた添え物2枚のid。"watch"に入った瞬間どちらも短い寿命へ
   *  作り直す（reseedForWatchDemo）。「つぎへ」が押せるようになる瞬間、
   *  その時点でまだ生きていればfreezeToRealPaceが本物の寿命へ切り替える
   *  ——ambientは判定対象に戻さない（seed()のとおり、結の「全部は残せ
   *  ません」という主題に残しておく1枚として扱う）ため、実質decoyだけが
   *  戻る対象。作り直すたびに新しいidへ更新する。 */
  private ambientId: string | null = null;
  private decoyId: string | null = null;
  /** 「振り返り」手順に入った瞬間の仮想時刻を固定した基準点。以降このスライダーの
   *  「N時間前」は、その都度のcurrentVirtualNow()ではなく常にこの値から引く
   *  ——探索にどれだけ実時間をかけても（数秒でも数分でも）見え方が変わらない
   *  ようにするため（ユーザー報告：巻き戻しても反応しないことがあった）。
   *  「たった今」（ms<=0）だけは例外でrewindAt=nullとなり、CircularCanvas側が
   *  常に本物のライブな現在時刻を使う——探索中ずっと同じ「今」に固定されて
   *  見えてしまうことはない。 */
  private rewindNowRef: number | null = null;

  constructor(container: HTMLElement, onComplete?: () => void, onStepTitle?: (title: string) => void) {
    this.onComplete = onComplete ?? null;
    this.onStepTitle = onStepTitle ?? null;
    container.className = "tutorial-sandbox";

    this.canvasWrap = document.createElement("div");
    this.canvasWrap.className = "tutorial-sandbox-canvas-wrap";

    this.messageEl = document.createElement("p");
    this.messageEl.className = "tutorial-sandbox-message";

    this.watchProgressWrap = document.createElement("div");
    this.watchProgressWrap.className = "tutorial-watch-progress";
    this.watchProgressWrap.hidden = true;
    this.watchProgressLabel = document.createElement("span");
    this.watchProgressLabel.className = "tutorial-watch-progress-label";
    this.watchProgressEl = document.createElement("progress");
    this.watchProgressEl.className = "tutorial-watch-progress-bar";
    this.watchProgressEl.max = 24;
    this.watchProgressEl.value = 0;
    this.watchProgressWrap.append(this.watchProgressLabel, this.watchProgressEl);

    this.rewindWrap = document.createElement("div");
    this.rewindWrap.className = "tutorial-sandbox-seek fade-visible";
    this.rewindWrap.hidden = true;
    this.setRewindVisible = createFadeVisibility(this.rewindWrap);

    const actions = document.createElement("div");
    actions.className = "tutorial-sandbox-actions";
    this.nextBtn = document.createElement("button");
    this.nextBtn.type = "button";
    this.nextBtn.className = "pill-btn";
    this.nextBtn.textContent = "つぎへ";
    // "watch"→"keep"だけでなく"rewind"→"done"でも同じボタンを再利用する
    // （syncNextBtnVisibility/checkProgress参照）ため、決め打ちの遷移先では
    // なく「今の手順の次」へ進める。
    this.nextBtn.addEventListener("click", () => {
      if (this.step === "done") {
        this.onComplete?.();
        return;
      }
      if (this.step === "watch") this.restoreAllMemos(this.currentVirtualNow());
      if (this.step === "erase") this.restoreAfterErase(this.currentVirtualNow());
      const nextStep = STEP_ORDER[STEP_ORDER.indexOf(this.step) + 1];
      if (nextStep) this.advanceTo(nextStep);
    });
    actions.append(this.nextBtn);

    container.append(this.canvasWrap, this.watchProgressWrap, this.messageEl, this.rewindWrap, actions);
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
      // 回転ジェスチャーの判定（270度・半径16px）は本物のキャンバスの既定値
      // （ROTATE_STEP_RAD/ROTATE_MIN_RADIUS_PX、canvasView.ts参照）と同じで
      // よいため、ここでは個別に上書きしない。
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
      nowProvider: () => this.currentVirtualNow(),
    });
    this.reviveInfoPill = new ReviveInfoPill(this.canvasWrap);
    this.realStartMs = Date.now();
    this.virtualBaseMs = Date.now();
    this.seed();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** 使い方ページを閉じたら呼ぶ。CircularCanvasのwindow単位リスナー等を
   *  destroy()できちんと解除し、rAFも止める——開いたままrAFを回し続けると
   *  無駄に電力を使う（usageGuide.tsの挿絵アニメーションと同じ理由）。 */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.nextBtnTimer !== null) {
      clearTimeout(this.nextBtnTimer);
      this.nextBtnTimer = null;
    }
    this.canvasView?.destroy();
    this.canvasView = null;
    this.reviveInfoPill = null;
    this.store = null;
    this.memoBaselines = [];
    this.watchStartMemos = [];
    this.watchStartAt = null;
    this.eraseStartMemos = [];
    this.eraseStartAt = null;
    this.knownMemoIds = new Set();
    this.ambientId = null;
    this.decoyId = null;
    this.rewindNowRef = null;
    this.rewindSelector = null;
    this.rewindWrap.replaceChildren();
    this.rewindWrap.hidden = true;
    this.rewindWrap.classList.remove("is-visible");
    this.rewindWrap.style.pointerEvents = "";
  }

  /** 「書く」手順だけテキスト道具、それ以外は選択（移動）道具——このサンドボックスで
   *  体験させたい操作を、書く・掴んで回す・振り返りスライダーの3つに絞る
   *  （道具バー自体は持たない。ユーザー指示）。 */
  private toolStateFor(): ToolState {
    return {
      tool: this.step === "write" ? "text" : this.step === "erase" ? "eraser" : "move",
      color: INK,
      // 「書く」手順で書いた1枚も、添え物2枚と一緒に薄れていく様子を見せたい
      // （ユーザー指示：「書き込みが全部薄くなるといいかも」）ため、"write"の
      // 間だけWATCH_DEMO_LIFESPAN_DAYS（短い寿命）で作る——書いたその瞬間
      // （経過0）から薄れ始め、"watch"の待ち時間のうちに目に見えて変化する。
      // 「つぎへ」が押せるようになる瞬間freezeToRealPaceが本物の寿命へ
      // 切り替えるため、薄れきって掴めなくなる心配はない。
      lifespanDays: this.step === "write" ? WATCH_DEMO_LIFESPAN_DAYS : FIXED_LIFESPAN_DAYS,
      fontSize: TUTORIAL_FONT_SIZE,
      lineWidth: PEN_LINE_WIDTH,
      eraserRadius: 16,
    };
  }

  /** 「書く」手順の前に、添え物を2枚だけ仕込んでおく——ユーザー自身が
   *  これから書く1枚と合わせて、後の手順（残す・消す・振り返る）で
   *  触る対象が最低3枚になるようにする。手を出さなくても物語が進むよう、
   *  どの手順にも紐付けない添え物として置く。 */
  private seed(): void {
    if (!this.store) return;
    const now0 = this.virtualBaseMs;
    // テキスト測定専用の使い捨てcanvas（DOMには挿入しない）。手描きストローク
    // だと、掴んで動かした先が円の縁にかかった時に点ごとクランプされて線が
    // 潰れて見えてしまう（ユーザー指摘）ため、位置だけがまとめてクランプされる
    // テキストメモに変えた。
    const measureCtx = document.createElement("canvas").getContext("2d")!;
    // 「薄れる」手順ですぐ見比べられるよう、既に薄れかけた状態で置く
    // （自分がこれから書く1枚は真新しいまま、という対比になる）。位置は
    // 左下寄り——decoyと対角に離すのに加え、円のほぼ中央（「書く」手順で
    // 最初にタップされやすい場所、ユーザー報告：中央に書いた自分のメモと
    // 添え物2枚の文字が重なって見えていた）から縦にも横にも離すため。
    // テキストメモの最小幅（MIN_TEXT_BOX_WIDTH_PX=140px、textLayout.ts）は
    // 正規化すると0.41もあり円の直径の2割に達するため、縦方向だけでなく
    // 横方向にもある程度離さないと、短いテキストどうしでも箱がすぐ隣接して
    // 窮屈に見えてしまう。
    const ambient = seedTextThought(measureCtx, this.store, { x: -0.25, y: 0.5 }, "夢の続き", 11 * HOUR, now0);
    // 掴んで振り回すと、その分だけメモ自体もポインタに追従して動く
    // （canvasView.tsのupdateRotationGesture参照）。縁ぎりぎりに置くと、
    // 少し振り回しただけで縁の外にはみ出して欠けて見えてしまうため、
    // 中心からある程度離しつつも振り回す余地は残す——ambientと対角
    // （右上寄り）に離すことで、円のほぼ中央にタップされても両方から
    // 十分な間隔を保てるようにしている。
    const decoy = seedTextThought(measureCtx, this.store, { x: 0.3, y: -0.5 }, "買い物リスト", 5 * HOUR, now0);
    this.knownMemoIds = new Set([ambient.id, decoy.id]);
    this.ambientId = ambient.id;
    this.decoyId = decoy.id;
    // 「残したい一枚」がどれかは指示文で特定していないため、この2枚
    // （＋「書く」手順でユーザーが書いたもの）すべてを判定対象にする
    // （checkProgress参照）。
    this.memoBaselines = [ambient, decoy].map(trackedMemoOf);
  }

  private currentVirtualNow(): number {
    return this.virtualBaseMs + (Date.now() - this.realStartMs) * VIRTUAL_ACCEL;
  }

  private loop = (): void => {
    if (!this.running || !this.store || !this.canvasView) return;
    const now = this.currentVirtualNow();
    this.store.tick(now);
    // "選びとる"は必ず「たった今」を見せる（ユーザー指示：「選びとる　今の
    // 状態を見せる」）。showPresentForDoneの一度きりの後始末（reset・
    // pointer-events:none）だけでは、既にドラッグ中だった指/マウスから
    // 送られる途中のnative inputイベントがその後始末より遅れて1つだけ
    // すり抜け、結局「たった今」ではない位置で止まってしまうことを実際の
    // ドラッグ操作で確認した——1回きりの後始末では勝てないタイミングの
    // 競合のため、こちらは「今の手順が"done"である限り、毎フレーム必ず
    // ライブ表示に上書きする」という形で確実性を持たせている。
    if (this.step === "done") this.canvasView.setRewindAt(null);
    this.canvasView.render(now);
    this.reviveInfoPill?.update(this.canvasView.getHoverRemainingMs(now));
    this.syncWatchProgress(now);
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
        this.memoBaselines.push(trackedMemoOf(newMemo));
        // Enterで入力を確定しただけで次の説明へ飛ばさず、ほかの手順と同じく
        // 本人が「つぎへ」を押してから進む。
        this.nextBtn.hidden = false;
      }
    } else if (this.step === "keep") {
      if (this.nextBtn.hidden && this.anyMemoMoved(memos, "up")) {
        this.nextBtn.hidden = false;
      }
    } else if (this.step === "erase") {
      const erased = this.memoBaselines.some((baseline) => !memos.some((memo) => memo.id === baseline.id));
      if (this.nextBtn.hidden && erased) {
        this.nextBtn.hidden = false;
      }
    } else if (this.step === "rewind" && this.nextBtn.hidden && (this.rewindSelector?.getRewindMs() ?? 0) > 0) {
      // スライダーを動かした瞬間に手順そのものを終わらせる（即advanceTo）と、
      // 少し動かしただけで問答無用で"選びとる"へ切り替わり、過去を眺める間も
      // 無く終わってしまう（ユーザー報告：「振り返るが位置をスライドさせた
      // 瞬間に終わってしまう」）。動かしたことを検知しても手順はまだ進めず、
      // 「つぎへ」を出すだけに留める——本人が納得いくまで振り返ってから、
      // 自分のタイミングで押して進められる（"watch"の「つぎへ」と同じ
      // 考え方）。inputイベントの発火に頼らず毎フレーム直接いまのスライダー
      // 値を見ているのは、以前onChange（inputイベント）が発火した時だけ
      // 達成フラグを立てていたときに、実際に遡って見えているのに次に
      // 進まないという報告があったため——イベントの取りこぼしが万一あっても
      // この方式なら次のフレーム（1/60秒後）には必ず現在値を拾える。
      this.nextBtn.hidden = false;
    }
  }

  /** memoBaselinesのうちどれか1枚でも、初期値からup(増加=反時計回り)/
   *  down(減少=時計回り)の向きに動いていればtrue。 */
  private anyMemoMoved(memos: readonly Memo[], direction: "up" | "down"): boolean {
    return this.memoBaselines.some((baseline) => {
      const memo = memos.find((m) => m.id === baseline.id);
      if (!memo) return false;
      return direction === "up"
        ? memo.lastTracedAt > baseline.initialLastTracedAt
        : memo.lastTracedAt < baseline.initialLastTracedAt;
    });
  }

  /** 手順を先に進める（後戻りはしない）。 */
  private advanceTo(step: StepId): void {
    if (STEP_ORDER.indexOf(step) <= STEP_ORDER.indexOf(this.step)) return;
    this.step = step;
    if (step === "watch") {
      const now = this.currentVirtualNow();
      this.watchStartMemos = [...structuredClone(this.store?.getAll() ?? [])];
      this.watchStartAt = now;
      this.reseedForWatchDemo(now);
    }
    if (step === "erase") {
      this.eraseStartMemos = [...structuredClone(this.store?.getAll() ?? [])];
      this.eraseStartAt = this.currentVirtualNow();
    }
    if (step === "rewind") this.mountRewind();
    if (step === "done") this.showPresentForDone();
    this.syncStep();
  }

  private syncStep(): void {
    this.messageEl.textContent = MESSAGES[this.step];
    this.nextBtn.textContent = this.step === "done" ? "はじめる" : "つぎへ";
    this.watchProgressWrap.hidden = this.step !== "watch";
    this.syncNextBtnVisibility();
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

  /** 短縮された「眺める」の経過を、通常の1日寿命における0〜24時間へ換算する。 */
  private syncWatchProgress(now: number): void {
    if (this.step !== "watch" || this.watchStartAt === null) return;
    const ratio = Math.min(1, Math.max(0, (now - this.watchStartAt) / WATCH_DEMO_TOTAL_VIRTUAL_MS));
    const hours = ratio * 24;
    this.watchProgressEl.value = hours;
    this.watchProgressLabel.textContent = `${Math.floor(hours)}時間経過`;
  }

  /** 「つぎへ」（"watch"手順専用）はこの手順に入って即座にではなく、
   *  WATCH_NEXT_BTN_DELAY_MSだけ待ってから出す（ユーザー指示：消える様子を
   *  見れるように、しばらくしてから表示する）。syncStep()はstep切り替えの
   *  たびに呼ばれるため、前の手順で仕込んだタイマーが残っていれば必ず
   *  clearTimeoutしてから改めて仕込み直す——stop()せずに手順が先へ進んだ場合
   *  （"watch"に留まっている間は起きないが、念のため）に、後から古いタイマーが
   *  誤って「つぎへ」を出してしまわないようにするための保険。「つぎへ」を
   *  出す瞬間にfreezeToRealPaceも呼ぶ——実際に押すのがその何秒後だろうと
   *  （読むのが遅い人・速い人で差がある）、これ以降は本物の緩やかな寿命
   *  でしか薄れないため、対象を取り逃す心配がなくなる。 */
  private syncNextBtnVisibility(): void {
    if (this.nextBtnTimer !== null) {
      clearTimeout(this.nextBtnTimer);
      this.nextBtnTimer = null;
    }
    this.nextBtn.hidden = true;
    if (this.step === "done") {
      this.nextBtn.hidden = false;
      return;
    }
    if (this.step !== "watch") return;
    this.nextBtnTimer = setTimeout(() => {
      this.nextBtnTimer = null;
      this.nextBtn.hidden = false;
    }, WATCH_NEXT_BTN_DELAY_MS);
  }

  /** 振り返りスライダーは「遡る」手順に入って初めて出す（一度に全部の道具を
   *  見せず、順番に体験させるため）。本物のRewindSelectorをそのまま使うが、
   *  値の受け渡し（getRewindAt）はDate.now()基準のため、加速した仮想時計を
   *  使うここでは生のms（getRewindMs）を自分で仮想「今」から引いて渡す。
   *  「今」はこの瞬間にrewindNowRefへ固定し、以後ずっとそれを使い続ける
   *  ——毎回this.currentVirtualNow()を呼び直すと、探索にかけた実時間ぶん
   *  「たった今」自体が動いてしまい、見本と目盛りの対応がその場でズレていく
   *  （ユーザー報告：巻き戻しても反応しないことがあった）。盤面自体は
   *  作り直さない——「眺める」を出た後の状態は、"keep"での
   *  ユーザー自身の操作も含めてそのまま引き継ぐ（ユーザー指示：「眺める」
   *  以外は状態を引き継ぐように）。 */
  private mountRewind(): void {
    if (this.rewindSelector) return;
    this.rewindNowRef = this.currentVirtualNow();
    this.rewindWrap.hidden = false;
    this.rewindSelector = new RewindSelector(this.rewindWrap, () => {
      if (!this.rewindSelector || !this.canvasView || this.rewindNowRef === null) return;
      const ms = this.rewindSelector.getRewindMs();
      this.canvasView.setRewindAt(ms <= 0 ? null : this.rewindNowRef - ms);
    });
    this.setRewindVisible(true);
  }

  /** "振り返る"（過去を見る）から"選びとる"（今を見せる）への切り替え
   *  （ユーザー指示：「振り返る　過去の状態を見る／選びとる　今の状態を
   *  見せる」）。RewindSelector.reset()・setRewindVisible(false)だけでは
   *  足りない——ユーザーがスライダーを掴んでドラッグし続けている最中に
   *  この手順へ切り替わった場合、resetで一旦「たった今」へ戻しても、
   *  掴んだままの指/マウスが送り続けるnative inputイベントに即座に
   *  上書きされてしまい、結局ドラッグを離した位置（過去のまま）で止まって
   *  しまうことを実際のドラッグ操作で確認した——しかもsetRewindVisible
   *  自体はhidden属性を即座には立てず（フェードアウトのため
   *  FADE_TRANSITION_MSだけ遅らせる、fadeVisibility.ts参照）、hidden属性が
   *  効いて初めてブラウザがポインタイベントを止めるため、その遅延の間も
   *  なお同じ問題が起きうる。pointer-eventsはCSSの見た目（opacity遷移）
   *  とは独立に即座に効くため、ここで明示的にnoneへ切り替えることで、
   *  フェードアウトの見た目はそのまま保ちつつ、以後いっさい掴めなくする
   *  ——「選びとる」の間は必ず「たった今」のまま固定される。stop()で
   *  次回開いたときのために元へ戻す。 */
  private showPresentForDone(): void {
    this.rewindWrap.style.pointerEvents = "none";
    this.rewindSelector?.reset();
    this.canvasView?.setRewindAt(null);
    // フェードアウト完了までスライダーをレイアウトに残すと、その180ms後に
    // ボタン位置がもう一度動く。手順切り替え時は即座に外して位置を一度で確定する。
    this.rewindWrap.classList.remove("is-visible");
    this.rewindWrap.hidden = true;
  }

  /** idで指定した1枚を、位置・文面を引き継いだまま作り直す
   *  （store.deleteMemo→seedTextThought）。対象が見つからない・テキスト
   *  メモでない場合はnullを返す（呼び出し元は「作り直せなかったので
   *  元のままにする」扱いにする）。reseedForWatchDemo/freezeToRealPaceが
   *  共通で使う。 */
  private reseedOne(staleId: string, now: number, backdateMs: number, lifespanDays: LifespanDays): Memo | null {
    if (!this.store) return null;
    const existing = this.store.getAll().find((m) => m.id === staleId);
    if (!existing || existing.kind !== "text") return null;
    this.store.deleteMemo(staleId);
    const measureCtx = document.createElement("canvas").getContext("2d")!;
    return seedTextThought(
      measureCtx,
      this.store,
      { x: existing.x, y: existing.y },
      existing.text,
      backdateMs,
      now,
      lifespanDays
    );
  }

  /** 「眺める」手順に入った瞬間、添え物2枚（ambient・decoy）をどちらも
   *  WATCH_DEMO_LIFESPAN_DAYS（短い寿命）で作り直す——seed()時点の固定
   *  バックデートのままだと「書く」手順にかかった時間（人によって大きく
   *  ばらつく）ぶん仮想時計が進んでしまい、この手順に入った時点で既に
   *  完全に消えている／逆にまだ薄れ始めてすらいない、ということが起きる
   *  ため、この手順に入った瞬間を新しい基準点にして作り直す。バックデート
   *  は2枚で別の値（WATCH_AMBIENT_BACKDATE_MS/WATCH_DECOY_BACKDATE_MS）
   *  ——全部同時に同じ濃さで消えると単調になってしまうため（ユーザー
   *  指摘）、あえて違うタイミングで薄れ消えるようにしてある。「書く」
   *  手順でユーザーが書いた1枚はここでは触らない——書いたその瞬間から
   *  toolStateForが既にWATCH_DEMO_LIFESPAN_DAYSで作っているため、作り
   *  直す必要が無い（かつ経過0からという3枚目のタイミングにもなる）。
   *  作り直した2枚はmemoBaselines（keep判定対象）から外す——
   *  この後すぐ完全に消えて掴めなくなる（status!=="active"はhitTestMemo
   *  に拾われない、canvasView.ts参照）ため、判定対象に残しても達成し
   *  ようがない——decoyは「つぎへ」が押せるようになる瞬間（freezeToRealPace）
   *  にまだ生きていれば判定対象へ戻る。 */
  private reseedForWatchDemo(now: number): void {
    const staleAmbientId = this.ambientId;
    const staleDecoyId = this.decoyId;
    const freshAmbient = staleAmbientId
      ? this.reseedOne(staleAmbientId, now, WATCH_AMBIENT_BACKDATE_MS, WATCH_DEMO_LIFESPAN_DAYS)
      : null;
    const freshDecoy = staleDecoyId
      ? this.reseedOne(staleDecoyId, now, WATCH_DECOY_BACKDATE_MS, WATCH_DEMO_LIFESPAN_DAYS)
      : null;
    if (freshAmbient) this.ambientId = freshAmbient.id;
    if (freshDecoy) this.decoyId = freshDecoy.id;
    this.memoBaselines = this.memoBaselines.filter((b) => b.id !== staleAmbientId && b.id !== staleDecoyId);
  }

  /** decoy・「書く」手順の1枚を、"watch"の短い寿命（WATCH_DEMO_LIFESPAN_DAYS）
   *  から本物の寿命（FIXED_LIFESPAN_DAYS）へ切り替える——ただし見た目の
   *  濃さ（不透明度の段階）はそのまま引き継ぐ（ユーザー指示：「眺めるの
   *  部分を除いて、チュートリアルメモの状態は引き継ぐようにしてほしい」）。
   *  経過時間と寿命の「比」を保ったままスケールし直すことで、切り替えた
   *  瞬間に濃さが飛んで見えることなく、以後は本物と同じ緩やかさで薄れて
   *  いく。既に消えきっていた（status!=="active"）ものは、位置・文面を
   *  保ったままREVIVE_BACKDATE_MSで復活させる——「引き継ぐ」を素直に
   *  適用すると消えたままになってしまい、「残す/手放す」で掴める対象が
   *  無くなって手順が進められなくなることがあった（ユーザー報告：「眺める
   *  の部分で全部消えてしまってそのままなので一向に進めない」）。decoyが
   *  （生きていた・復活させた、いずれの理由であれ）手元にあれば、
   *  memoBaselines（keep判定対象）へ改めて加える——"watch"に入った
   *  瞬間reseedForWatchDemoが一旦外していたため。ambientはここでは一切
   *  触らない——"rewind"に入るまで戻さない、結の「全部は残せません」と
   *  いう主題に残しておく1枚として扱う（seed()参照）。「つぎへ」が押せる
   *  ようになる瞬間（syncNextBtnVisibility）に一度だけ呼ぶ——それ以降は
   *  実際に押すまで実時間をどれだけかけようと、本物の緩やかな寿命でしか
   *  薄れないため、対象を取り逃す心配がなくなる。 */
  /** 「眺める」で薄れたものを、「つぎへ」が押された瞬間にまとめて戻す。
   *  内容と位置はそのまま保ち、全メモを本来の寿命・完全に見える状態へ揃える。 */
  private restoreAllMemos(now: number): void {
    if (!this.store) return;
    const elapsed = this.watchStartAt === null ? 0 : now - this.watchStartAt;
    const source = this.watchStartMemos.length > 0 ? this.watchStartMemos : this.store.getAll();
    const restored = source.map((memo) => ({
      ...structuredClone(memo),
      createdAt: memo.createdAt + elapsed,
      lastTracedAt: memo.lastTracedAt + elapsed,
      traceHistory: memo.traceHistory.map((timestamp) => timestamp + elapsed),
      // 「眺める」専用の短い寿命は演出終了時に破棄し、ユーザーが書いたものも
      // 元からあるものも、チュートリアル開始時と同じ通常寿命へ統一する。
      lifespanDays: FIXED_LIFESPAN_DAYS,
      status: "active" as const,
    }));
    this.store.replaceAll(restored);
    this.memoBaselines = restored.map(trackedMemoOf);
  }

  /** 消しゴムの結果を元へ戻す。操作にかかった時間ぶん時刻も平行移動し、
   *  消す前の濃さ・残り時間をそのまま保つ。 */
  private restoreAfterErase(now: number): void {
    if (!this.store || this.eraseStartMemos.length === 0) return;
    const elapsed = this.eraseStartAt === null ? 0 : now - this.eraseStartAt;
    const restored = this.eraseStartMemos.map((memo) => ({
      ...structuredClone(memo),
      createdAt: memo.createdAt + elapsed,
      lastTracedAt: memo.lastTracedAt + elapsed,
      traceHistory: memo.traceHistory.map((timestamp) => timestamp + elapsed),
      status: "active" as const,
    }));
    this.store.replaceAll(restored);
    this.memoBaselines = restored.map(trackedMemoOf);
  }

}

/** 短い「思いつき」のテキストメモを、指定した仮想時刻に作られたことにして
 *  仕込む。backdateMsぶん過去に作ったことにすることで、開いた瞬間から
 *  薄れかけの盤面を見せられる。lifespanDaysは省略時、本物と同じ
 *  FIXED_LIFESPAN_DAYS——「眺める」手順の間だけ、この手順専用の短い寿命
 *  （WATCH_DEMO_LIFESPAN_DAYS）を明示的に渡す
 *  （reseedForWatchDemo/toolStateFor参照）。 */
function seedTextThought(
  measureCtx: CanvasRenderingContext2D,
  store: MemoStore,
  center: Point,
  text: string,
  backdateMs: number,
  now0: number,
  lifespanDays: LifespanDays = FIXED_LIFESPAN_DAYS
): Memo {
  const fontSize = TUTORIAL_FONT_SIZE;
  const boxWidthPx = measureTextBoxWidthPx(measureCtx, text, fontSize);
  const textLines = wrapTextAtReferenceScale(measureCtx, text, fontSize, boxWidthPx);
  const { width, height } = normalizedBoxSize(fontSize, textLines.length, boxWidthPx);
  return store.createTextMemo(
    center,
    text,
    textLines,
    fontSize,
    width,
    height,
    { color: INK, lifespanDays },
    now0 - backdateMs
  );
}

function trackedMemoOf(memo: Memo): TrackedMemo {
  return { id: memo.id, initialLastTracedAt: memo.lastTracedAt };
}
