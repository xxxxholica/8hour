import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { ICONS } from "./icons";
import type { SessionState, StartSessionOptions } from "./sharedCanvas";

export const PHASE_LABEL: Record<SessionState["phase"], string> = {
  ideation: "アイデア出し",
  discussion: "議論",
  voting: "採択・絞り込み",
  results: "結果",
};

/** 延長ボタン1回あたりの延長量。 */
const EXTEND_MS = 5 * 60 * 1000;

/** セッションの残り時間表示専用。fade.tsのformatDurationJaは複数日にまたがる
 *  長い猶予期間向けに一番大きい2単位だけを見せる作りで、数分〜数十分の
 *  フェーズの残り時間には粗すぎる（ユーザー指示：「4分20秒」のように秒まで
 *  見せたい）ため、ここだけ分・秒に絞った専用の書式にする。 */
function formatMinutesSeconds(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}秒`;
  return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
}

/** フェーズの長さ・参加人数上限のスライダー範囲。 */
const MINUTES_RANGE = { min: 1, max: 30, step: 1, default: 5 } as const;
// 上限は4(=眼鏡2組)——3組(6人)は実機確認の結果、画面上での表示が安定しない
// (組数が増えるほど1組あたりが小さくなりすぎる・レイアウト崩れが目立つ)と
// 判断し、レンズ分割(lensSplit.ts LENS_COUNT)自体の上限を4に引き下げた
// （issue #79、ユーザー指示）。
const MAX_PARTICIPANTS_RANGE = { min: 1, max: 4, step: 1, default: 4 } as const;

interface SessionPanelCallbacks {
  onStart: (options: StartSessionOptions) => void;
  onAdvance: () => void;
  onExtend: (addMs: number) => void;
  onEnd: () => void;
  /** "results"(投票確定後の結果ロック、issue #114/#119対応)から編集を再開する。 */
  onResume: () => void;
}

/**
 * 共有キャンバスの「共同アイデア出し」セッション(issue #59)のフェーズ表示・
 * ルームマスター操作を担うパネル。ReviveInfoPillと同じく命令的なupdate()を
 * render()のたびに呼ぶ形にし、開閉はSharedRoomMenu/AppearanceSelectorと
 * 同じ.icon-anchor/.icon-popoverパターンをそのまま使う。
 *
 * トリガーボタンは常に表示しておき、操作できない間（ルームマスターでない、
 * またはセッション未開始でマスターでもない）は.pill-btn:disabledの薄い表示に
 * する——招待リンク欄などこのアプリの既存の「隠すのではなく無効表示」という
 * 慣習に合わせる（ユーザー指示）。
 */
export class SessionPanel {
  private callbacks: SessionPanelCallbacks;

  private anchor!: HTMLElement;
  private trigger!: HTMLButtonElement;
  private triggerLabelEl!: HTMLElement;
  private popover!: HTMLElement;
  private popoverFade!: (show: boolean) => void;
  private readonly closeRef = () => this.close();
  private open = false;

  private startForm!: HTMLElement;
  private phase1Slider!: HTMLInputElement;
  private phase2Slider!: HTMLInputElement;
  private phase3Slider!: HTMLInputElement;
  private maxParticipantsSlider!: HTMLInputElement;

  private activeControls!: HTMLElement;
  private resultsControls!: HTMLElement;
  private phaseLabelEl!: HTMLElement;

  private isMaster = false;

  constructor(container: HTMLElement, callbacks: SessionPanelCallbacks) {
    this.callbacks = callbacks;
    this.buildDom(container);
  }

  private buildDom(container: HTMLElement): void {
    this.anchor = document.createElement("div");
    this.anchor.className = "icon-anchor";

    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "pill-btn session-panel-trigger";
    this.trigger.innerHTML = ICONS.timer;
    this.triggerLabelEl = document.createElement("span");
    this.trigger.appendChild(this.triggerLabelEl);
    this.trigger.addEventListener("click", () => this.toggle());
    this.anchor.appendChild(this.trigger);

    this.popover = document.createElement("div");
    this.popover.className = "session-panel-popover icon-popover";
    this.popover.hidden = true;
    this.popoverFade = createFadeVisibility(this.popover);

    this.phaseLabelEl = document.createElement("p");
    this.phaseLabelEl.className = "shared-section-label";
    this.popover.appendChild(this.phaseLabelEl);

    // 未開始時: フェーズの長さ・上限人数をスライダーで決めて開始する。
    this.startForm = document.createElement("div");
    this.startForm.className = "session-start-form";
    this.phase1Slider = this.buildSlider(this.startForm, PHASE_LABEL.ideation, MINUTES_RANGE, "分");
    this.phase2Slider = this.buildSlider(this.startForm, PHASE_LABEL.discussion, MINUTES_RANGE, "分");
    this.phase3Slider = this.buildSlider(this.startForm, PHASE_LABEL.voting, MINUTES_RANGE, "分");
    this.maxParticipantsSlider = this.buildSlider(this.startForm, "参加人数の上限", MAX_PARTICIPANTS_RANGE, "人");
    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "pill-btn pill-btn--primary";
    startBtn.textContent = "セッションを開始";
    startBtn.addEventListener("click", () => {
      this.callbacks.onStart({
        phase1Ms: Number(this.phase1Slider.value) * 60 * 1000,
        phase2Ms: Number(this.phase2Slider.value) * 60 * 1000,
        phase3Ms: Number(this.phase3Slider.value) * 60 * 1000,
        maxParticipants: Number(this.maxParticipantsSlider.value),
      });
      this.close();
    });
    this.startForm.appendChild(startBtn);
    this.popover.appendChild(this.startForm);

    // 進行中: 次のフェーズへ／延長／終了。
    this.activeControls = document.createElement("div");
    this.activeControls.className = "session-active-controls";
    const advanceBtn = document.createElement("button");
    advanceBtn.type = "button";
    advanceBtn.className = "pill-btn";
    advanceBtn.textContent = "次のフェーズへ";
    advanceBtn.addEventListener("click", () => {
      this.callbacks.onAdvance();
      this.close();
    });
    const extendBtn = document.createElement("button");
    extendBtn.type = "button";
    extendBtn.className = "pill-btn";
    extendBtn.textContent = "延長 +5分";
    extendBtn.addEventListener("click", () => this.callbacks.onExtend(EXTEND_MS));
    const endBtn = document.createElement("button");
    endBtn.type = "button";
    endBtn.className = "pill-btn";
    endBtn.textContent = "セッションを終了";
    endBtn.addEventListener("click", () => {
      this.callbacks.onEnd();
      this.close();
    });
    this.activeControls.append(advanceBtn, extendBtn, endBtn);
    this.popover.appendChild(this.activeControls);

    // "results"(投票確定後の結果ロック、issue #114/#119対応): 編集を再開するまで
    // 全員が読み取り専用のまま留まる。再開前に既存のエクスポート機能(設定メニュー内
    // ExportSection、PNG/TXT書き出し)を使うよう一言添えて誘導する。
    this.resultsControls = document.createElement("div");
    this.resultsControls.className = "session-active-controls";
    const resultsHint = document.createElement("p");
    resultsHint.className = "session-results-hint";
    // issue #114: 確定済みメモは確定から24時間で自動的に削除される(ダウンロードの
    // 有無を問わない)ため、その旨をここで案内する。
    resultsHint.textContent =
      "投票結果が確定しました。24時間後に自動的に削除されるので、必要であれば編集を再開する前に設定メニューの「エクスポート」(PNG/TXT)で保存しておいてください。";
    const resumeBtn = document.createElement("button");
    resumeBtn.type = "button";
    resumeBtn.className = "pill-btn pill-btn--primary";
    resumeBtn.textContent = "編集を再開";
    resumeBtn.addEventListener("click", () => {
      this.callbacks.onResume();
      this.close();
    });
    this.resultsControls.append(resultsHint, resumeBtn);
    this.popover.appendChild(this.resultsControls);

    this.anchor.appendChild(this.popover);
    container.appendChild(this.anchor);
  }

  /** ラベルと現在値を同じ行の両端に置き（左:ラベル、右:現在値）、その下に
   *  全幅のスライダーを敷く1項目分の行を作る（ユーザー指示：現在値はスライダーの
   *  タイトルの真横ではなく右上に見せたい）。 */
  private buildSlider(
    parent: HTMLElement,
    label: string,
    range: { min: number; max: number; step: number; default: number },
    unit: string
  ): HTMLInputElement {
    const row = document.createElement("div");
    row.className = "session-form-row";

    const header = document.createElement("div");
    header.className = "session-form-header";
    const labelEl = document.createElement("span");
    labelEl.className = "session-form-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "session-form-value";
    header.append(labelEl, valueEl);
    row.appendChild(header);

    const input = document.createElement("input");
    input.type = "range";
    input.className = "session-slider";
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(range.default);
    input.setAttribute("aria-label", label);
    const sync = () => {
      valueEl.textContent = `${input.value}${unit}`;
    };
    input.addEventListener("input", sync);
    sync();
    row.appendChild(input);
    parent.appendChild(row);
    return input;
  }

  private toggle(): void {
    if (this.open) this.close();
    else this.openPopover();
  }

  private openPopover(): void {
    if (!this.isMaster) return;
    notifyOpen(this.closeRef, this.anchor);
    this.open = true;
    this.popover.hidden = false;
    this.popoverFade(true);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.popoverFade(false);
    notifyClose(this.closeRef);
  }

  /** ルーム切り替えなど、表示を続ける意味が無くなったタイミングで呼ぶ。 */
  reset(): void {
    this.close();
  }

  /** disabled/innerHTMLは値が変わった時だけ書き換える——render()のたびに無条件で
   *  書き込むと、ボタンを押している最中(pointerdown〜pointerup)に毎フレーム再代入が
   *  挟まってしまい、Chromiumがそのクリックのclickイベント生成を握りつぶす不具合が
   *  あった(実機・コンソールのイベントトレースで確認: pointerdown/pointerupは届くのに
   *  clickだけ一度も発火しない)。 */
  private setTriggerLabel(html: string): void {
    if (this.triggerLabelEl.innerHTML !== html) this.triggerLabelEl.innerHTML = html;
  }

  /** render()のたびに呼ぶ。isMasterはgetCurrentUser()?.id === ownerIdで判定した値を渡す。 */
  update(now: number, isMaster: boolean, session: SessionState | null): void {
    this.isMaster = isMaster;

    if (this.trigger.disabled !== !isMaster) this.trigger.disabled = !isMaster;

    if (!session) {
      // 未開始: 誰でも見えるが、マスターでなければ押せない（招待リンク欄などと
      // 同じ、隠すのではなく無効表示にする慣習）。
      // 画面幅が狭いと3ボタン（ルーム作成・見た目の設定・セッション開始）が
      // 並びきらない（ユーザー指摘）ため、.label-full/.label-shortをCSS側の
      // メディアクエリで出し分けて短縮表示にする（style.css参照）。
      this.setTriggerLabel('<span class="label-full">セッションを開始</span><span class="label-short">セッション</span>');
      this.startForm.hidden = false;
      this.activeControls.hidden = true;
      this.resultsControls.hidden = true;
      this.phaseLabelEl.hidden = true;
      return;
    }

    if (session.phase === "results") {
      // 結果ロック中はカウントダウンが無いので固定文言のみ。
      this.setTriggerLabel("結果発表中");
    } else {
      // フェーズ名+残り時間（例:「採択・絞り込み 4分35秒」)。狭幅では.label-short側
      // だけが見え、残り時間のみに短縮される(issue #150)。時間部分は
      // .session-panel-trigger-time(tabular-nums + min-width、.session-form-valueと
      // 同じ考え方)で、桁数が変わってもボタン幅がガタつかないようにする(issue #152)。
      const remaining = formatMinutesSeconds(session.phaseEndsAt - now);
      const timeHtml = `<span class="session-panel-trigger-time">${remaining}</span>`;
      this.setTriggerLabel(
        `<span class="label-full">${PHASE_LABEL[session.phase]} ${timeHtml}</span><span class="label-short">${timeHtml}</span>`
      );
    }

    if (!isMaster) {
      // 非マスターは静的な表示のみ——ポップオーバーは開かせない。
      if (this.open) this.close();
      return;
    }

    this.startForm.hidden = true;
    const isResults = session.phase === "results";
    this.activeControls.hidden = isResults;
    this.resultsControls.hidden = !isResults;
    this.phaseLabelEl.hidden = false;
    this.phaseLabelEl.textContent = isResults ? "結果発表中" : `現在: ${PHASE_LABEL[session.phase]}`;
  }
}
