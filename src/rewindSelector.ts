import { DURATION_STEPS } from "./durationSteps";
import { createFadeVisibility } from "./fadeVisibility";

interface RewindStep {
  label: string;
  ms: number;
}

/**
 * 振り返りスライダーの目盛り。DURATION_STEPS（15分〜3日の8段階）を
 * 「何分/時間/日前か」という向き——遠い過去（左）から現在（右）へ——に並べ替え、
 * 右端に「たった今」（=現在、ms=0）を足した9個の目盛り。
 * 上限が3日なのは、検索性を意図的に下げるための制約——「消えたものを掘り返せる
 * 道具」にしたくない、という設計判断（旧ArchiveViewから引き継ぐ）。あえて絶対時刻は
 * 出さず、「1時間前」のような相対表現（＝目盛りのラベルそのもの）だけにしているのも
 * 同じ理由から。
 */
const REWIND_STEPS: RewindStep[] = [
  ...DURATION_STEPS.slice()
    .reverse()
    .map((step) => ({ label: `${step.label}前`, ms: step.ms })),
  { label: "たった今", ms: 0 },
];

const MAX_INDEX = REWIND_STEPS.length - 1;

/**
 * 下部バー・右ブロック（旧・時間選択ブロック）: 「消えるまでの期間」を選ぶ役割は
 * 無くなった（常に1日固定、fade.tsのFIXED_LIFESPAN_DAYS参照）ため、代わりに
 * 「過去に遡って見る」ためのシークバーとしてこの枠を転用する（ユーザー指示）。
 * 「雨雲レーダー」のようにスライドすると、その瞬間のキャンバスの状態
 * （生きているメモも消えたメモも含む）を再現する——実際の再現描画は
 * CircularCanvas.setRewindAt()側で行う（このクラスは値の受け渡しだけを担う）。
 *
 * 以前はDurationSelectorとして「消えるまでの期間」を1段刻みのスライダーで
 * 選ばせていたが、そちらの役目は無くなり、旧ArchiveView（振り返り専用の別画面）が
 * 持っていた「引っかかりの無い連続スクラブ」の挙動をこちらへ移植した
 * （step="any"、msAtPosition参照）。
 */
export class RewindSelector {
  private el: HTMLElement;
  private container: HTMLElement;
  private onChange?: () => void;
  private labelEl!: HTMLButtonElement;
  private slider!: HTMLInputElement;
  /** REWIND_STEPSへの位置（大きいほど現在に近い）。整数なら目盛りちょうど、
   *  小数なら隣り合う目盛りの間の連続値（msAtPosition参照）。既定は末尾＝たった今。 */
  private position = MAX_INDEX;

  constructor(container: HTMLElement, onChange?: () => void) {
    this.container = container;
    this.onChange = onChange;
    this.el = document.createElement("div");
    this.el.className = "duration-seekbar control-block";
    this.container.appendChild(this.el);
    this.build();
    this.attachTooltip();
  }

  /** 遡り先の絶対時刻（ms）。「たった今」（=末尾の目盛り）ならnull＝ライブ表示。 */
  getRewindAt(): number | null {
    const ms = this.getRewindMs();
    if (ms <= 0) return null;
    return Date.now() - ms;
  }

  /** 現在の目盛り位置が表す「何ms前か」を、Date.now()と無関係な生の値で返す。
   *  使い方ページの練習用サンドボックス（tutorialSandbox.ts）は本物の壁時計
   *  ではなく加速した仮想時計で動くため、絶対時刻への変換はDate.now()基準の
   *  getRewindAt()ではなく、ここで得たmsを呼び出し側の仮想「今」から引いて
   *  自前で行う。 */
  getRewindMs(): number {
    return this.msAtPosition(this.position);
  }

  private build(): void {
    // ラベルをボタンにし、タップで即座に「たった今」へ戻せるようにする
    // （ユーザー指示：指先の精度に頼らずライブ表示へ復帰する手段が欲しい、
    // issue #103）。ラベル自体は今の目盛りの表示を兼ねたままにする——専用の
    // 「戻る」ボタンを別途増やすより、既に常時表示されているこの領域を
    // タップ対象に転用する方が省スペース。
    this.labelEl = document.createElement("button");
    this.labelEl.type = "button";
    this.labelEl.className = "duration-seekbar-label";
    this.labelEl.setAttribute("aria-label", "たった今に戻る");
    this.labelEl.addEventListener("click", () => this.reset());
    this.el.appendChild(this.labelEl);

    this.slider = document.createElement("input");
    this.slider.type = "range";
    this.slider.className = "duration-seekbar-slider";
    this.slider.min = "0";
    this.slider.max = String(MAX_INDEX);
    // 振り返り本来の挙動（引っかかりの無い連続スクラブ）を踏襲する。
    this.slider.step = "any";
    this.slider.value = String(this.position);
    this.slider.setAttribute("aria-label", "遡って見る");
    this.slider.addEventListener("input", () => {
      this.position = Number(this.slider.value);
      this.syncLabel();
      this.onChange?.();
    });
    this.el.appendChild(this.slider);

    this.syncLabel();
  }

  /** 「たった今」（＝ライブ表示）に戻す。main.tsが個人キャンバスのタブを離れる
   *  時に呼ぶ——遡ったまま他のタブに移ると、共通の道具バーが無効化されたままに
   *  なってしまうため（main.tsのsetView参照）。 */
  reset(): void {
    if (this.position === MAX_INDEX) return;
    this.position = MAX_INDEX;
    this.slider.value = String(MAX_INDEX);
    this.syncLabel();
    this.onChange?.();
  }

  /** 他の道具ボタン（Toolbar.attachToolTooltip参照）と同じ、ホバーで機能名を
   *  上に出す案内。振り返りバーだけこの案内が無く、初見だと何のスライダーか
   *  分かりにくい、というユーザー指摘のため。同じ.icon-popover/.tool-tooltip
   *  の見た目・フェードをそのまま流用し、マウスの時だけ働かせる（タッチでは
   *  「押さずに触れる」状態が無く、タップの前後にちらつくだけになるため）。 */
  private attachTooltip(): void {
    const tooltip = document.createElement("span");
    tooltip.className = "icon-popover tool-tooltip";
    tooltip.textContent = "振り返り";
    tooltip.hidden = true;
    this.el.appendChild(tooltip);
    const setVisible = createFadeVisibility(tooltip);
    this.el.addEventListener("pointerenter", (ev) => {
      if (ev.pointerType === "mouse") setVisible(true);
    });
    this.el.addEventListener("pointerleave", () => setVisible(false));
  }

  private syncLabel(): void {
    const nearestStep = REWIND_STEPS[Math.round(this.position)];
    this.labelEl.textContent = nearestStep.label;
  }

  /** positionは今やREWIND_STEPSへの整数インデックスではなく、隣り合う2つの目盛りの
   *  間を連続値で表す位置（例: 6.4 = インデックス6と7の間、7寄り）。目盛りが表す
   *  時刻(ms)を線形補間して返す——引っかかりを無くすため、スライダーの見た目上の
   *  動きはなめらかにしつつ、目盛り自体（15分・30分…という遡り幅の並び）はそのまま
   *  流用する。 */
  private msAtPosition(pos: number): number {
    const clamped = Math.max(0, Math.min(MAX_INDEX, pos));
    const lo = Math.floor(clamped);
    const hi = Math.min(MAX_INDEX, lo + 1);
    const frac = clamped - lo;
    const loMs = REWIND_STEPS[lo].ms;
    const hiMs = REWIND_STEPS[hi].ms;
    return loMs + (hiMs - loMs) * frac;
  }
}
