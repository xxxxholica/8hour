import { setGuestAuth, type GuestAuth } from "./apiClient";
import { getCurrentUser, onUserChange } from "./authState";
import { requestSignIn } from "./clerkAccount";
import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { claimGuestInvite, loadGuestSession, saveGuestSession, type StoredGuestSession } from "./guestSession";
import { ICONS } from "./icons";
import {
  createSharedCanvas,
  joinSharedCanvas,
  leaveSharedCanvas,
  listSharedCanvases,
  mintInvite,
  renameSharedCanvas,
  type SharedCanvasSummary,
} from "./sharedCanvas";

const JOIN_PARAM = "join";
// 招待リンク経由のゲスト参加(issue #79)用の2パラメータ。inviteはclaim後に
// URLから外すが、roomは残す(リロード時に保存済みのゲストセッションで
// サイレントに再開できるようにするため、handlePendingInvite参照)。
const INVITE_PARAM = "invite";
const ROOM_PARAM = "room";
const CREATE_LABEL = "新しいルームを作成";
const COPY_LABEL = "共有URLをコピー";

/**
 * 眼鏡キャンバスの下（smuiView.getRoomMenuSlot()）に置く、共有キャンバス
 * （ルーム）の作成・選択・招待リンクのポップアップメニュー。キャンバス自体は
 * 「選んだルームのキャンバス」だけを表示するようにし、ルームの作成・切り替え
 * という操作はここに切り出してある。
 *
 * 実際にどのルームを表示するかは、選択結果をコールバック（onSelectRoom）で
 * SmuiView.selectRoom()へ渡すだけで、このクラス自身はキャンバスの中身を
 * 一切扱わない。ポップアップの開閉は道具バーのテンプレート選択（toolbar.ts の
 * buildTemplateControl）と同じ .icon-anchor/.icon-popover パターンをそのまま
 * 使う——ボタンが画面下寄りにあるため、既定の上向きに開けば画面内に収まる。
 */
export class SharedRoomMenu {
  private onSelectRoom: (id: string) => void;
  private onAutoOpen: () => void;
  private onGuestJoined: (canvasId: string, guestAuth: GuestAuth) => void;
  private pendingJoinId: string | null;
  /** 招待リンク(?invite=&room=)からのゲスト参加待ち。claim成功でnullに戻す。 */
  private pendingInviteToken: string | null;
  private pendingInviteRoom: string | null;
  /** 招待リンク経由でログイン無しに参加した状態か。trueの間はsignedIn同様
   *  mainEl(ルーム作成・一覧)は出さない——ゲストは自分のルーム一覧を持たない。 */
  private guestMode = false;
  private signedIn = false;
  private busy = false;
  private open = false;
  private readonly closeRef = () => this.close();

  private anchor!: HTMLElement;
  private btn!: HTMLButtonElement;
  private btnIconEl!: HTMLElement;
  private btnLabelEl!: HTMLElement;
  private popover!: HTMLElement;
  private popoverFade!: (show: boolean) => void;
  private signedOutEl!: HTMLElement;
  private guestPromptEl!: HTMLElement;
  private guestStatusEl!: HTMLElement;
  private guestInfoEl!: HTMLElement;
  private mainEl!: HTMLElement;
  private createBtnLabelEl!: HTMLElement;
  private createBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private copyBtnLabelEl!: HTMLElement;
  private copyBtn!: HTMLButtonElement;
  private roomListEl!: HTMLUListElement;
  private emptyEl!: HTMLElement;
  private copyFeedbackTimer: number | undefined;

  private rooms: SharedCanvasSummary[] = [];
  private selectedId: string | null = null;
  /** 選択中のルームへの招待リンク。表示用の入力欄は持たず（ユーザー指示：
   *  文字＋アイコンの「共有URLをコピー」ボタン1つにまとめる）、コピー時に
   *  参照するためだけに保持する。 */
  private inviteUrl: string | null = null;

  constructor(
    container: HTMLElement,
    onSelectRoom: (id: string) => void,
    onAutoOpen: () => void,
    onGuestJoined: (canvasId: string, guestAuth: GuestAuth) => void
  ) {
    this.onSelectRoom = onSelectRoom;
    this.onAutoOpen = onAutoOpen;
    this.onGuestJoined = onGuestJoined;
    const params = new URLSearchParams(location.search);
    this.pendingJoinId = params.get(JOIN_PARAM);
    this.pendingInviteToken = params.get(INVITE_PARAM);
    this.pendingInviteRoom = params.get(ROOM_PARAM);

    this.buildDom(container);
    this.updateTriggerLabel();

    onUserChange((user) => {
      const wasSignedIn = this.signedIn;
      this.signedIn = user !== null;
      this.updateVisibility();
      if (this.signedIn && !wasSignedIn) void this.handleSignedIn();
    });

    if (this.pendingInviteRoom) void this.handlePendingInvite();
  }

  /** signedOutEl/guestPromptEl/guestInfoEl/mainElの表示・非表示を、現在の
   *  状態(Clerkサインイン中／招待の入力待ち／ゲスト参加済み／未接続)に
   *  合わせて一括で更新する。 */
  private updateVisibility(): void {
    const showGuestPrompt = !this.signedIn && !this.guestMode && this.pendingInviteRoom !== null;
    this.signedOutEl.hidden = this.signedIn || this.guestMode || showGuestPrompt;
    this.guestPromptEl.hidden = !showGuestPrompt;
    this.guestInfoEl.hidden = !this.guestMode;
    this.mainEl.hidden = !this.signedIn;
  }

  private buildDom(container: HTMLElement): void {
    this.anchor = document.createElement("div");
    this.anchor.className = "icon-anchor";

    // 以前はアイコンのみのボタンだったが、何のボタンか一目で分かりにくかった
    // （ユーザー指摘）ため、文字を持たせる——未接続時は「＋ルームを作成」、
    // ルーム接続中はそのルームIDの先頭7文字（一覧のbtn.titleと同じ考え方で
    // フルIDはtitle属性に持たせる）を表示する。
    this.btn = document.createElement("button");
    this.btn.type = "button";
    this.btn.className = "pill-btn shared-room-trigger";
    this.btn.setAttribute("aria-label", "共有キャンバスの作成・選択");
    this.btn.addEventListener("click", () => this.toggle());
    // ルーム接続中は家のアイコンを添える——IDの文字列だけだと何のボタンか
    // 分かりにくい（ユーザー指摘）。未接続の「＋ルームを作成」は文字だけで
    // 自明なため、アイコンはupdateTriggerLabelで接続中だけ表示する。
    this.btnIconEl = document.createElement("span");
    this.btnIconEl.className = "shared-room-trigger-icon";
    this.btnIconEl.innerHTML = ICONS.room;
    this.btn.appendChild(this.btnIconEl);
    this.btnLabelEl = document.createElement("span");
    this.btn.appendChild(this.btnLabelEl);
    this.anchor.appendChild(this.btn);

    this.popover = document.createElement("div");
    // ボタンが眼鏡キャンバスの下（画面下寄り）に置かれるようになったため、
    // 下向きではなく既定の上向き（道具バーのテンプレートメニューと同じ）に
    // 開く——下向きのままだと画面外にはみ出してしまう（ユーザー指摘）。
    this.popover.className = "shared-room-popover icon-popover";
    this.popover.hidden = true;
    this.popoverFade = createFadeVisibility(this.popover);

    this.signedOutEl = document.createElement("div");
    this.signedOutEl.className = "shared-signedout";
    const signedOutMessage = document.createElement("p");
    signedOutMessage.textContent = "共有キャンバスを使うには、ログインしてください。";
    const signInBtn = document.createElement("button");
    signInBtn.type = "button";
    signInBtn.className = "pill-btn";
    signInBtn.textContent = "ログイン/新規登録";
    signInBtn.addEventListener("click", requestSignIn);
    this.signedOutEl.append(signedOutMessage, signInBtn);
    this.popover.appendChild(this.signedOutEl);

    // 招待リンク(?invite=&room=)経由でログイン無しに参加する人向けの状態表示
    // (issue #79)。以前は表示名を尋ねるフォームがあったが、その表示名は
    // どこにも表示されない書き込み専用の値になっていた(issue #128のリアクション
    // 実名表示機能がrevertされたため)ので廃止し、招待リンクを開いた時点で
    // 自動的に参加する(ユーザー指摘：入力させる意味が無いなら省いてすぐ開けるように)。
    // ここはその間の「参加しています…」表示、または招待が無効/期限切れの場合の
    // エラー表示専用になる。
    this.guestPromptEl = document.createElement("div");
    this.guestPromptEl.className = "shared-guest-prompt";
    this.guestPromptEl.hidden = true;
    this.guestStatusEl = document.createElement("p");
    this.guestStatusEl.className = "shared-status";
    this.guestPromptEl.appendChild(this.guestStatusEl);
    this.popover.appendChild(this.guestPromptEl);

    this.guestInfoEl = document.createElement("p");
    this.guestInfoEl.className = "shared-signedout";
    this.guestInfoEl.textContent = "ゲストとして参加中です。";
    this.guestInfoEl.hidden = true;
    this.popover.appendChild(this.guestInfoEl);

    this.mainEl = document.createElement("div");
    this.mainEl.className = "shared-room-menu-main";
    this.mainEl.hidden = true;

    // 2つの区画（ルーム一覧／作成・招待）を.shared-menu-sectionで区切り、
    // 同じカードの中でも役割の境目が見えるようにする（ユーザー指摘：色々な
    // 要素が区切りなく1枚に同居している）。「新しいルームを作成」「共有URLを
    // コピー」は既存ルームの一覧よりも下の、カードの右下に横並びで置く
    // （ユーザー指示）——新規作成・招待は毎回の操作ではなく、既存ルームの
    // 参加・選択の方が主な用途のため。招待リンクは以前ラベル+入力欄+コピー
    // ボタンの3点だったが、表示用の値を持つ意味が薄い（コピーできれば十分）
    // ため、アイコン付きの「共有URLをコピー」ボタン1つに統合した（ユーザー指示）。
    const createSection = document.createElement("div");
    createSection.className = "shared-menu-section shared-create-section";
    const actionsRow = document.createElement("div");
    actionsRow.className = "shared-create-actions";

    this.createBtn = document.createElement("button");
    this.createBtn.type = "button";
    this.createBtn.className = "pill-btn pill-btn--primary pill-btn--icon";
    this.createBtnLabelEl = document.createElement("span");
    this.createBtnLabelEl.className = "shared-create-btn-label";
    this.createBtnLabelEl.textContent = CREATE_LABEL;
    this.createBtn.innerHTML = ICONS.plus;
    this.createBtn.appendChild(this.createBtnLabelEl);
    this.createBtn.addEventListener("click", () => void this.handleCreate());
    actionsRow.appendChild(this.createBtn);

    // ルームを選ぶまでは押せない・薄い表示のまま常に出しておく（ユーザー
    // 指摘：どこに出るか事前に分かるようにしたい、という以前の入力欄と同じ
    // 考え方をボタンの disabled 表示に引き継ぐ）。
    this.copyBtn = document.createElement("button");
    this.copyBtn.type = "button";
    this.copyBtn.className = "pill-btn pill-btn--icon";
    this.copyBtnLabelEl = document.createElement("span");
    this.copyBtnLabelEl.className = "shared-copy-btn-label";
    this.copyBtnLabelEl.textContent = COPY_LABEL;
    this.copyBtn.innerHTML = ICONS.link;
    this.copyBtn.appendChild(this.copyBtnLabelEl);
    this.copyBtn.disabled = true;
    this.copyBtn.addEventListener("click", () => void this.copyInviteLink());
    actionsRow.appendChild(this.copyBtn);

    createSection.appendChild(actionsRow);
    // ここには成功メッセージ（「作成しました」等）は出さない——招待リンクが
    // 現れること自体が成功の合図になるため、専用の1行を使ってまで知らせる
    // 必要がない（ユーザー指摘：無駄な表示で1行使わない）。エラーと、
    // ボタンを持たない自動参加中の一時的な状態表示だけをここに出す。
    this.statusEl = document.createElement("p");
    this.statusEl.className = "shared-status";
    createSection.appendChild(this.statusEl);

    const listSection = document.createElement("div");
    listSection.className = "shared-menu-section";
    const listLabel = document.createElement("div");
    listLabel.className = "shared-section-label";
    listLabel.textContent = "参加中のルーム";
    listSection.appendChild(listLabel);

    this.roomListEl = document.createElement("ul");
    this.roomListEl.className = "shared-room-list";
    listSection.appendChild(this.roomListEl);

    this.emptyEl = document.createElement("p");
    this.emptyEl.className = "archive-empty";
    this.emptyEl.textContent = "参加中の共有キャンバスがありません。作成するか、招待リンクから参加してください。";
    this.emptyEl.hidden = true;
    listSection.appendChild(this.emptyEl);

    this.mainEl.appendChild(listSection);
    this.mainEl.appendChild(createSection);

    this.popover.appendChild(this.mainEl);
    this.anchor.appendChild(this.popover);
    container.appendChild(this.anchor);
  }

  private toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  private openMenu(): void {
    if (this.open) return;
    notifyOpen(this.closeRef, this.anchor);
    this.open = true;
    this.btn.dataset.active = "true";
    this.popoverFade(true);
    if (this.signedIn) void this.refreshRoomList();
    // 招待リンクは作成直後だけでなく、今選んでいるルームがあれば開くたびに
    // 出す（ユーザー指摘：作成直後しか出てこないのは不便）。
    if (this.selectedId) void this.showInviteLink(this.selectedId);
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.btn.dataset.active = "false";
    this.popoverFade(false);
    notifyClose(this.closeRef);
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private clearJoinParam(): void {
    const url = new URL(location.href);
    url.searchParams.delete(JOIN_PARAM);
    history.replaceState(null, "", url);
  }

  /** claim成功後、inviteパラメータだけURLから外す。roomは残し、リロード時に
   *  保存済みのゲストセッションでサイレントに再開できるようにする
   *  (handlePendingInvite参照)。 */
  private clearInviteTokenParam(): void {
    const url = new URL(location.href);
    url.searchParams.delete(INVITE_PARAM);
    history.replaceState(null, "", url);
  }

  /** ページ読み込み時、URLに?room=があれば呼ばれる(issue #79: 招待リンク経由の
   *  ゲスト参加)。既に有効なゲストセッションが保存済みならそれで無言で再開する。
   *  そうでなければ表示名等は尋ねず、招待トークンをそのままclaimして自動的に
   *  参加する(ユーザー指摘：表示名はどこにも表示されず入力させる意味が無いので、
   *  フローを省いてすぐ開けるようにする)。招待トークンが無効/期限切れの場合は
   *  guestStatusElに理由だけ表示する。 */
  private async handlePendingInvite(): Promise<void> {
    const room = this.pendingInviteRoom;
    if (!room) return;
    // コンストラクタから同期的に呼ばれるため、ここで一度マイクロタスクへ逃がす
    // ——main.ts側はSharedRoomMenuの生成(=このメソッドの呼び出し)より後で
    // let currentViewを初期化しており、onAutoOpen(setView)を同期のまま
    // 呼ぶとTDZ(初期化前アクセス)で例外になる。
    await Promise.resolve();
    const stored = loadGuestSession(room);
    if (stored) {
      this.activateGuestMode(stored);
      return;
    }
    const token = this.pendingInviteToken;
    if (!token) {
      this.guestStatusEl.textContent = "この招待リンクは期限切れです";
      this.updateVisibility();
      this.onAutoOpen();
      this.openMenu();
      return;
    }
    this.guestStatusEl.textContent = "参加しています…";
    this.updateVisibility();
    // このボタン・ポップオーバー自体がsmuiView.getRoomMenuSlot()経由で「共有」
    // タブの中にあり、キャンバスタブ表示中はhidden属性で隠れている
    // (main.ts参照)。参加中の表示を見せるにはタブ自体の切り替えが必要
    // ——参加成功後だけでなく、この時点でonAutoOpenを呼ぶ。
    this.onAutoOpen();
    this.openMenu();
    try {
      const session = await claimGuestInvite(room, token);
      saveGuestSession(session);
      this.activateGuestMode(session);
    } catch (e) {
      this.guestStatusEl.textContent = e instanceof Error ? e.message : "参加に失敗しました";
    }
  }

  /** ゲストとしての参加を確定させる。claim直後・保存済みセッションでの
   *  リロード後の再開、どちらからも呼ばれる。 */
  private activateGuestMode(session: StoredGuestSession): void {
    this.guestMode = true;
    this.pendingInviteRoom = null;
    this.pendingInviteToken = null;
    this.clearInviteTokenParam();
    setGuestAuth({ canvasId: session.canvasId, token: session.token });
    this.selectedId = session.canvasId;
    this.updateTriggerLabel();
    this.updateVisibility();
    this.onGuestJoined(session.canvasId, { canvasId: session.canvasId, token: session.token });
    this.onAutoOpen();
    this.close();
  }

  /** トリガーボタンの文字を今の状態に合わせる：未接続なら「＋ルームを作成」、
   *  接続中ならそのルームIDの先頭7文字（フルIDはtitle属性に持たせる）。 */
  private updateTriggerLabel(): void {
    if (this.selectedId) {
      this.btnIconEl.hidden = false;
      this.btnLabelEl.textContent = this.selectedId.slice(0, 7);
      this.btn.title = this.selectedId;
    } else {
      this.btnIconEl.hidden = true;
      // 画面幅が狭いと3ボタン（ルーム作成・見た目の設定・セッション開始）が
      // 並びきらない（ユーザー指摘）ため、.label-full/.label-shortをCSS側の
      // メディアクエリで出し分けて短縮表示にする（style.css参照）。未接続時は
      // btnIconEl（実アイコン）を出さず「＋」の文字がアイコン代わりのため
      // （ユーザー指摘：スマホでルームのアイコンが消える）、短縮表示でも
      // 「＋」は削らずに残す。
      this.btnLabelEl.innerHTML =
        '<span class="label-full">＋ルームを作成</span><span class="label-short">＋ルーム</span>';
      this.btn.title = "";
    }
  }

  /** 指定したルームへの招待リンクを組み立てて表示する。自分がそのルームの
   *  オーナー(ルームマスター)であれば、ログイン不要のゲスト参加リンク
   *  (?invite=&room=、issue #79)をサーバーに発行してもらう——オーナー以外
   *  (メンバーだが招待は発行できない・まだ一覧を読み込めていない等)は、
   *  従来通りClerkログイン前提の?join=リンクにフォールバックする。 */
  private async showInviteLink(id: string): Promise<void> {
    const room = this.rooms.find((r) => r.id === id);
    const isOwner = room !== undefined && getCurrentUser()?.id === room.ownerId;
    const url = new URL(location.href);
    url.search = "";
    if (isOwner) {
      try {
        const { token } = await mintInvite(id);
        url.searchParams.set(INVITE_PARAM, token);
        url.searchParams.set(ROOM_PARAM, id);
        this.inviteUrl = url.toString();
        this.copyBtn.disabled = false;
        return;
      } catch {
        // 発行に失敗した場合は下のClerkログイン前提リンクにフォールバックする。
      }
    }
    url.searchParams.set(JOIN_PARAM, id);
    this.inviteUrl = url.toString();
    this.copyBtn.disabled = false;
  }

  private async handleSignedIn(): Promise<void> {
    if (this.pendingJoinId) {
      const id = this.pendingJoinId;
      this.pendingJoinId = null;
      this.clearJoinParam();
      // 自動参加はボタンを押す操作を経ないため、進行中を示す手段がここしか
      // ない（作成・コピーはボタン自身の文字を差し替えるだけで済ませている
      // のと対照的）。成功時は招待リンクが現れる・ルームが選ばれた状態に
      // なること自体が合図になるので、成功メッセージは出さずすぐ消す。
      // ポップオーバーを開いておかないとこのstatusEl自体が(hidden内なので)
      // 見えず、失敗した時にも無言のまま終わってしまう——実際に招待リンク
      // 経由の自動参加が失敗しても気付けなかった不具合があったため。
      this.openMenu();
      this.setStatus("参加しています…");
      try {
        await joinSharedCanvas(id);
        await this.refreshRoomList();
        this.selectedId = id;
        this.updateTriggerLabel();
        this.renderRoomList();
        this.onSelectRoom(id);
        void this.showInviteLink(id);
        this.setStatus("");
        this.onAutoOpen();
        // 成功時は「共有」タブに切り替わったこと自体が合図になるので、
        // ポップオーバーは開けたままにしない（ユーザー指摘：開きっぱなしは
        // 邪魔）。失敗時は原因が読めるよう、閉じずに残す。
        this.close();
      } catch (e) {
        this.setStatus(e instanceof Error ? e.message : "参加に失敗しました");
      }
    }
  }

  private async handleCreate(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setStatus("");
    this.createBtn.disabled = true;
    this.createBtnLabelEl.textContent = "作成中…";
    try {
      const id = await createSharedCanvas();
      await this.refreshRoomList();
      this.selectedId = id;
      this.updateTriggerLabel();
      this.renderRoomList();
      this.onSelectRoom(id);
      // 成功メッセージは出さない——招待リンクが現れて一覧に新しいルームが
      // 選択状態で並ぶこと自体が「できた」の合図になる（ユーザー指摘：
      // 無駄な表示で1行使わない）。
      void this.showInviteLink(id);
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : "作成に失敗しました");
    } finally {
      this.busy = false;
      this.createBtn.disabled = false;
      this.createBtnLabelEl.textContent = CREATE_LABEL;
    }
  }

  /** コピーの成否は、別行のステータス文字ではなくボタン自身の文字を
   *  一瞬だけ差し替えて伝える（ユーザー指摘：無駄な表示で1行使わない）。
   *  以前は失敗時に入力欄を選択状態にするフォールバックがあったが、
   *  表示用の入力欄自体を廃止した（ユーザー指示：ボタン1つに統合）ため、
   *  失敗はstatusEl（エラー用）に出すだけにする。 */
  private async copyInviteLink(): Promise<void> {
    if (!this.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(this.inviteUrl);
      this.flashCopyButton("コピーしました");
    } catch {
      this.setStatus("コピーできませんでした");
    }
  }

  private flashCopyButton(text: string): void {
    window.clearTimeout(this.copyFeedbackTimer);
    this.copyBtnLabelEl.textContent = text;
    this.copyFeedbackTimer = window.setTimeout(() => {
      this.copyBtnLabelEl.textContent = COPY_LABEL;
    }, 1500);
  }

  private async refreshRoomList(): Promise<void> {
    try {
      this.rooms = await listSharedCanvases();
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : "一覧の取得に失敗しました");
      this.rooms = [];
    }
    this.renderRoomList();
  }

  /** ルームの行は[ルーム名][名前を変更][退出]の3要素。以前は「名前を変更」を
   *  ホバー／長押しで開く別メニュー（.shared-room-list外・body直下に置く
   *  必要があった、.shared-room-listのoverflow-y:autoで切られないように
   *  するため）に格上げしていたが、そのメニューがexclusivePopover.tsの
   *  「ポップオーバーの外をクリックしたら閉じる」判定の対象外（body直下＝
   *  .icon-anchorの外）になり、メニュー内のボタンを押した瞬間に判定が
   *  先に発火してルームメニュー全体が閉じてしまい、名前変更が実質使えなく
   *  なっていた（ユーザー指摘・診断）。アクションはどうせ1つしかないため、
   *  別メニューに格上げする理由自体が無く、常時表示のアイコンボタンに戻す
   *  （.icon-anchorの内側に留まるため上記の問題も構造的に起きない）。 */
  private renderRoomList(): void {
    this.roomListEl.innerHTML = "";
    this.emptyEl.hidden = this.rooms.length > 0;
    for (const room of this.rooms) {
      const li = document.createElement("li");
      li.className = "shared-room-item";

      const nameWrap = document.createElement("div");
      nameWrap.className = "shared-room-name-wrap";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-btn shared-room-btn";
      const label = room.name ?? `${room.id.slice(0, 8)}…`;
      btn.textContent = label;
      // 長い名前は.shared-room-btnのCSSで省略表示(…)されるため、
      // titleは表示中のラベル自体にしてホバーで全文を確認できるようにする。
      btn.title = label;
      btn.setAttribute("aria-pressed", String(room.id === this.selectedId));
      btn.addEventListener("click", () => {
        this.selectedId = room.id;
        this.updateTriggerLabel();
        this.renderRoomList();
        this.onSelectRoom(room.id);
        void this.showInviteLink(room.id);
        this.close();
      });
      nameWrap.appendChild(btn);

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "pill-btn shared-room-rename";
      renameBtn.textContent = "編集";
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.startRename(li, room);
      });
      nameWrap.appendChild(renameBtn);

      li.appendChild(nameWrap);

      const leaveBtn = document.createElement("button");
      leaveBtn.type = "button";
      leaveBtn.className = "pill-btn shared-room-leave";
      leaveBtn.textContent = "退室";
      leaveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.handleLeave(room.id, label, leaveBtn);
      });
      li.appendChild(leaveBtn);

      this.roomListEl.appendChild(li);
    }
  }

  /** ルームから退出する。他のメンバーが誰も残っていない場合、サーバー側で
   *  ルーム自体も即削除される（バックエンド仕様）——確認ダイアログはその
   *  可能性を含めて伝える。 */
  private async handleLeave(id: string, label: string, btn: HTMLButtonElement): Promise<void> {
    const confirmed = window.confirm(
      `「${label}」から退出します。他のメンバーが誰も残っていない場合、ルーム自体も削除されます。よろしいですか？`
    );
    if (!confirmed) return;
    btn.disabled = true;
    try {
      await leaveSharedCanvas(id);
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : "退出に失敗しました");
      btn.disabled = false;
      return;
    }
    this.rooms = this.rooms.filter((room) => room.id !== id);
    // 今表示中のルームから退出した場合、一覧上はどれも選択されていない
    // 状態に戻す（キャンバス自体は次にルームを選ぶまでそのまま残る）。
    if (this.selectedId === id) {
      this.selectedId = null;
      this.updateTriggerLabel();
    }
    this.renderRoomList();
  }

  /** ルーム項目の名前ボタンを、blurで確定・Escapeでキャンセルする入力欄に一時的に置き換える。
   *  確定時はPATCH /shared-canvases/:idでサーバーに保存し、他のメンバーにも
   *  見える名前になる（バックエンド仕様、2026-08-24）。 */
  private startRename(li: HTMLLIElement, room: SharedCanvasSummary): void {
    const labelBtn = li.querySelector<HTMLButtonElement>(".shared-room-btn");
    if (!labelBtn) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "shared-room-rename-input";
    // 未設定の名前の初期値はid（UUID全体）ではなく空にする——編集せずに
    // フォーカスを外しただけでUUID丸ごとが名前として保存される事故を防ぐ。
    // id自体はplaceholderとして薄く見せておく。
    input.value = room.name ?? "";
    input.placeholder = `${room.id.slice(0, 8)}…`;
    labelBtn.replaceWith(input);
    input.focus();
    input.select();

    // 日本語IMEの変換候補確定は、キー入力としてはEnter/Escapeだが、
    // 名前入力全体の確定・取り消しではない——canvasView.tsのテキスト編集
    // （openTextEditor）と同じcompositionstart/end追跡パターンを使う。
    let composing = false;
    let lastCompositionEndAt = 0;
    const COMPOSITION_GRACE_MS = 50;
    input.addEventListener("compositionstart", () => {
      composing = true;
    });
    input.addEventListener("compositionend", () => {
      composing = false;
      lastCompositionEndAt = performance.now();
    });

    let cancelled = false;
    input.addEventListener("blur", () => {
      if (cancelled) {
        this.renderRoomList();
        return;
      }
      const trimmed = input.value.trim();
      // サーバーは空の名前を受け付けない（1〜100文字必須）ため、空欄のまま
      // フォーカスを外した場合は「変更しない」扱いにする（削除APIは無い）。
      if (!trimmed || trimmed === room.name) {
        this.renderRoomList();
        return;
      }
      input.disabled = true;
      void renameSharedCanvas(room.id, trimmed)
        .then(() => {
          room.name = trimmed;
        })
        .catch((e) => {
          this.setStatus(e instanceof Error ? e.message : "名前の保存に失敗しました");
        })
        .finally(() => {
          this.renderRoomList();
        });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.isComposing && !composing) {
        cancelled = true;
        input.blur();
        return;
      }
      const justFinishedComposing = performance.now() - lastCompositionEndAt < COMPOSITION_GRACE_MS;
      if (e.key === "Enter" && !e.isComposing && !composing && e.keyCode !== 229 && !justFinishedComposing) {
        e.preventDefault();
        input.blur();
      }
    });
  }
}
