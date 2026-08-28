import { createFadeVisibility } from "./fadeVisibility";
import { ICONS } from "./icons";
import { createCustomTemplate, deleteCustomTemplate, getAllTemplates, isCustomTemplateId } from "./templates";
import type { TemplateDef, TemplateId } from "./templates";
import { TEXT_FONT_FAMILY } from "./textLayout";

/** 「テーマ」欄は最低1つ（必須）から、＋で増やせる（ユーザー指示）。無制限に
 *  増やせると一覧・保存データが肥大するため、実用上十分な数で止める。 */
const MAX_THEME_FIELDS = 6;

/**
 * 空のキャンバスの「＋テンプレートを使用」から開く、全画面のテンプレート選択
 * （ユーザー指示：道具バーの小さなポップアップメニューから、キャンバスを使い始める
 * 最初の選択肢へ格上げする）。「このアプリで何ができるか」を最初に見せる場でもある
 * ため、各カードには実際に盤面へ置かれる文面をそのままプレビューとして載せる。
 *
 * 選ばれたテンプレートの通知先（コールバック）は「今表示中の画面」で決まるが、
 * それはmain.ts側（Toolbar.insertTemplate → onInsertTemplateがcurrentViewを見る）
 * が担うため、この画面自体はどのタブから開かれたかを気にしない——アプリ全体で
 * 1つのインスタンスを使い回せば足りる。
 */
export class TemplatePicker {
  private root: HTMLElement;
  private sheet: HTMLElement;
  private setVisible: (show: boolean) => void;
  private opened = false;
  private lastFocused: HTMLElement | null = null;
  private onChoose: (id: TemplateId) => void;

  private gridEl!: HTMLElement;
  private footEl!: HTMLElement;
  private createEl!: HTMLElement;
  private headingInput!: HTMLInputElement;
  private themeListEl!: HTMLElement;
  private themeInputs: HTMLInputElement[] = [];
  private addThemeBtn!: HTMLButtonElement;
  private createStatusEl!: HTMLElement;
  /** grid: カード一覧を表示中／create: 新規テンプレート作成フォームを表示中。
   *  開き直すたびgridへ戻す（open参照）。 */
  private mode: "grid" | "create" = "grid";

  constructor(onChoose: (id: TemplateId) => void) {
    this.onChoose = onChoose;
    this.root = document.createElement("div");
    this.root.className = "template-picker fade-visible";
    this.root.hidden = true;
    // 幕（背景）自身をクリックした場合は選ばずに閉じる（シート自身へのクリックは
    // 内側の要素までバブリングしてくるだけなので誤って閉じない）。
    this.root.addEventListener("pointerdown", (ev) => {
      if (ev.target === this.root) this.close();
    });

    this.sheet = document.createElement("section");
    this.sheet.className = "template-picker-sheet";
    this.sheet.setAttribute("role", "dialog");
    this.sheet.setAttribute("aria-modal", "true");
    this.sheet.setAttribute("aria-labelledby", "template-picker-title");
    this.sheet.tabIndex = -1;
    this.root.appendChild(this.sheet);

    this.buildHead();
    this.buildGrid();
    this.buildFoot();
    this.buildCreateForm();

    this.setVisible = createFadeVisibility(this.root);
    document.body.appendChild(this.root);
  }

  private buildHead(): void {
    const head = document.createElement("div");
    head.className = "template-picker-head";

    const heading = document.createElement("div");
    const title = document.createElement("h2");
    title.id = "template-picker-title";
    title.className = "template-picker-title";
    title.innerHTML = `${ICONS.checklist}<span>テンプレートから始める</span>`;
    const lead = document.createElement("p");
    lead.className = "template-picker-lead";
    lead.textContent = "よく書くかたちを下書きとして置けます。空欄は後からテキスト道具で書き込めます。";
    heading.append(title, lead);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "template-picker-close";
    closeBtn.setAttribute("aria-label", "閉じる");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());

    head.append(heading, closeBtn);
    this.sheet.appendChild(head);
  }

  private buildGrid(): void {
    this.gridEl = document.createElement("div");
    this.gridEl.className = "template-picker-grid";
    this.sheet.appendChild(this.gridEl);
    this.renderGrid();
  }

  /** カード一覧を作り直す（ユーザー作成テンプレートを保存・削除した直後の反映用）。
   *  「新規テンプレートを作成」タイルは一覧の先頭に置く。 */
  private renderGrid(): void {
    this.gridEl.replaceChildren();
    this.gridEl.appendChild(this.buildCreateTile());
    for (const tpl of getAllTemplates()) {
      this.gridEl.appendChild(isCustomTemplateId(tpl.id) ? this.buildCustomCard(tpl) : this.buildCard(tpl));
    }
  }

  /** カードの中身（名前・説明・プレビュー）。組み込み・ユーザー作成の両方で使う。 */
  private buildCardContent(tpl: TemplateDef): DocumentFragment {
    const frag = document.createDocumentFragment();

    const label = document.createElement("span");
    label.className = "template-card-label";
    label.textContent = tpl.label;

    const desc = document.createElement("span");
    desc.className = "template-card-desc";
    desc.textContent = tpl.description;

    const preview = document.createElement("p");
    preview.className = "template-card-preview";
    preview.style.fontFamily = TEXT_FONT_FAMILY;
    preview.textContent = tpl.text;

    frag.append(label, desc, preview);
    return frag;
  }

  /** 組み込みテンプレートのカード。削除できないため、カード全体をボタン1つにできる。 */
  private buildCard(tpl: TemplateDef): HTMLButtonElement {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "template-card";
    card.appendChild(this.buildCardContent(tpl));
    card.addEventListener("click", () => this.choose(tpl.id));
    return card;
  }

  /**
   * ユーザー作成テンプレートのカード。右上のゴミ箱ボタンで削除できる（ユーザー指示）。
   * カード全体を1つのボタンにはできない（削除ボタンをその中にネストできないため）ので、
   * 本文を選ぶボタンとゴミ箱ボタンを兄弟として並べたdivをカードにする。削除は誤操作を
   * 避けるため即実行せず、カード内でいったん「本当に削除しますか」の確認に切り替える
   * （ユーザー指示：削除する際は確認画面をはさむ）。
   */
  private buildCustomCard(tpl: TemplateDef): HTMLElement {
    const card = document.createElement("div");
    card.className = "template-card template-card--custom";

    const chooseBtn = document.createElement("button");
    chooseBtn.type = "button";
    chooseBtn.className = "template-card-choose";
    chooseBtn.appendChild(this.buildCardContent(tpl));
    chooseBtn.addEventListener("click", () => this.choose(tpl.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "template-card-delete";
    deleteBtn.setAttribute("aria-label", `「${tpl.label}」を削除`);
    deleteBtn.innerHTML = ICONS.trash;

    const confirm = document.createElement("div");
    confirm.className = "template-card-confirm";
    confirm.hidden = true;

    const confirmText = document.createElement("p");
    confirmText.className = "template-card-confirm-text";
    confirmText.textContent = `「${tpl.label}」を削除しますか？`;

    const actions = document.createElement("div");
    actions.className = "template-card-confirm-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pill-btn";
    cancelBtn.textContent = "キャンセル";
    const confirmDeleteBtn = document.createElement("button");
    confirmDeleteBtn.type = "button";
    confirmDeleteBtn.className = "pill-btn template-card-confirm-delete";
    confirmDeleteBtn.textContent = "削除する";
    actions.append(cancelBtn, confirmDeleteBtn);
    confirm.append(confirmText, actions);

    const showConfirm = () => {
      chooseBtn.hidden = true;
      deleteBtn.hidden = true;
      confirm.hidden = false;
    };
    const hideConfirm = () => {
      confirm.hidden = true;
      chooseBtn.hidden = false;
      deleteBtn.hidden = false;
    };
    deleteBtn.addEventListener("click", showConfirm);
    cancelBtn.addEventListener("click", hideConfirm);
    confirmDeleteBtn.addEventListener("click", () => {
      deleteCustomTemplate(tpl.id);
      this.renderGrid();
    });

    card.append(chooseBtn, deleteBtn, confirm);
    return card;
  }

  private buildCreateTile(): HTMLButtonElement {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "template-card template-card--create";

    const plus = document.createElement("span");
    plus.className = "template-card-create-plus";
    plus.textContent = "＋";

    const label = document.createElement("span");
    label.className = "template-card-label";
    label.textContent = "新規テンプレートを作成";

    tile.append(plus, label);
    tile.addEventListener("click", () => this.showCreateForm());
    return tile;
  }

  private buildFoot(): void {
    this.footEl = document.createElement("p");
    this.footEl.className = "template-picker-foot";
    this.footEl.textContent = "選んだあと、盤面の置きたい場所をタップします。";
    this.sheet.appendChild(this.footEl);
  }

  /**
   * 見出し・テーマ（1つ以上）を入力して、組み込みテンプレートと同じ形の
   * テンプレートを作る画面。カード一覧を隠してこのフォームだけを見せる
   * （別の全画面を重ねるのではなく同じシートの中で切り替える）。
   */
  private buildCreateForm(): void {
    this.createEl = document.createElement("div");
    this.createEl.className = "template-picker-create";
    this.createEl.hidden = true;

    const lead = document.createElement("p");
    lead.className = "template-picker-lead";
    lead.textContent = "見出しと、書きたいテーマを入力します。テーマは＋で増やせます。";
    this.createEl.appendChild(lead);

    const headingSection = document.createElement("div");
    headingSection.className = "shared-menu-section";
    const headingLabel = document.createElement("div");
    headingLabel.className = "shared-section-label";
    headingLabel.textContent = "見出し";
    this.headingInput = document.createElement("input");
    this.headingInput.type = "text";
    this.headingInput.className = "shared-invite-input template-create-input";
    this.headingInput.placeholder = "例: 旅行の計画";
    this.headingInput.addEventListener("input", () => this.clearCreateStatus());
    headingSection.append(headingLabel, this.headingInput);
    this.createEl.appendChild(headingSection);

    const themeSection = document.createElement("div");
    themeSection.className = "shared-menu-section";
    const themeLabel = document.createElement("div");
    themeLabel.className = "shared-section-label";
    themeLabel.textContent = "テーマ";
    this.themeListEl = document.createElement("div");
    this.themeListEl.className = "template-theme-list";
    this.addThemeBtn = document.createElement("button");
    this.addThemeBtn.type = "button";
    this.addThemeBtn.className = "pill-btn";
    this.addThemeBtn.textContent = "＋ テーマを追加";
    this.addThemeBtn.addEventListener("click", () => this.addThemeField());
    themeSection.append(themeLabel, this.themeListEl, this.addThemeBtn);
    this.createEl.appendChild(themeSection);

    this.createStatusEl = document.createElement("p");
    this.createStatusEl.className = "template-create-status";
    this.createEl.appendChild(this.createStatusEl);

    const actions = document.createElement("div");
    actions.className = "template-create-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pill-btn";
    cancelBtn.textContent = "キャンセル";
    cancelBtn.addEventListener("click", () => this.showGrid());
    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "pill-btn pill-btn--primary template-create-submit";
    submitBtn.textContent = "作成";
    submitBtn.addEventListener("click", () => this.submitCreateForm());
    actions.append(cancelBtn, submitBtn);
    this.createEl.appendChild(actions);

    this.sheet.appendChild(this.createEl);
  }

  /** テーマ欄を1つ増やす。1つ目（テーマ1）は必須で消せないが、
   *  2つ目以降はユーザー指示どおり＋で増やし、×で消せるようにする。 */
  private addThemeField(): void {
    if (this.themeInputs.length >= MAX_THEME_FIELDS) return;
    const removable = this.themeInputs.length > 0;

    const row = document.createElement("div");
    row.className = "template-theme-row";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "shared-invite-input template-create-input";
    input.placeholder = `テーマ${this.themeInputs.length + 1}`;
    input.addEventListener("input", () => this.clearCreateStatus());
    row.appendChild(input);
    this.themeInputs.push(input);

    if (removable) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "template-picker-close template-theme-remove";
      removeBtn.setAttribute("aria-label", "このテーマを削除");
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        const idx = this.themeInputs.indexOf(input);
        if (idx !== -1) this.themeInputs.splice(idx, 1);
        row.remove();
        this.syncThemePlaceholders();
        this.syncAddThemeBtn();
      });
      row.appendChild(removeBtn);
    }

    this.themeListEl.appendChild(row);
    this.syncAddThemeBtn();
  }

  /** テーマを削除したとき、残った欄の番号（プレースホルダー）を詰め直す。 */
  private syncThemePlaceholders(): void {
    this.themeInputs.forEach((input, i) => {
      if (!input.value) input.placeholder = `テーマ${i + 1}`;
    });
  }

  private syncAddThemeBtn(): void {
    this.addThemeBtn.disabled = this.themeInputs.length >= MAX_THEME_FIELDS;
  }

  private clearCreateStatus(): void {
    this.createStatusEl.textContent = "";
  }

  private resetCreateForm(): void {
    this.headingInput.value = "";
    this.themeListEl.replaceChildren();
    this.themeInputs = [];
    this.createStatusEl.textContent = "";
    this.addThemeField();
    this.syncAddThemeBtn();
  }

  private showCreateForm(): void {
    this.mode = "create";
    this.resetCreateForm();
    this.gridEl.hidden = true;
    this.footEl.hidden = true;
    this.createEl.hidden = false;
    this.headingInput.focus();
  }

  private showGrid(): void {
    this.mode = "grid";
    this.createEl.hidden = true;
    this.gridEl.hidden = false;
    this.footEl.hidden = false;
  }

  private submitCreateForm(): void {
    const heading = this.headingInput.value.trim();
    // テーマ1（先頭欄、消せない）は必須。2つ目以降は空なら詰めて捨てる。
    const firstTheme = this.themeInputs[0]?.value.trim() ?? "";
    const restThemes = this.themeInputs
      .slice(1)
      .map((input) => input.value.trim())
      .filter((v) => v.length > 0);
    if (!heading || !firstTheme) {
      this.createStatusEl.textContent = "見出しと、テーマ1は入力してください。";
      return;
    }
    createCustomTemplate(heading, [firstTheme, ...restThemes]);
    this.renderGrid();
    this.showGrid();
  }

  private choose(id: TemplateId): void {
    // 選んだ瞬間にそのまま盤面へ置かれる（次にタップする手順は無い）ので、
    // 普通のダイアログと同じく閉じた元のボタンへフォーカスを戻してよい。
    this.close();
    this.onChoose(id);
  }

  /** Escapeで画面全体のキー入力を横取りする間、背後のキャンバスへ流れて
   *  文字キー1つでテキスト入力が始まってしまう（canvasView.onGlobalKeyDown）
   *  のを防ぐ——bubble段ではなくcapture段で止める。 */
  private onKeyDown = (ev: KeyboardEvent): void => {
    ev.stopPropagation();
    if (ev.key !== "Escape") return;
    // 作成フォームを開いている間のEscapeは、画面全体を閉じずカード一覧へ戻す
    // だけにする（入力中に誤操作で全部閉じてしまわないように）。
    if (this.mode === "create") this.showGrid();
    else this.close();
  };

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.showGrid();
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.setVisible(true);
    window.addEventListener("keydown", this.onKeyDown, true);
    requestAnimationFrame(() => this.sheet.focus());
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.setVisible(false);
    this.lastFocused?.focus();
    this.lastFocused = null;
  }
}
