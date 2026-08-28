import { FRAME_SHAPE_ORDER, getFrameShape } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import { buildFramePatternPicker } from "./framePattern";
import type { FramePatternId } from "./framePattern";
import { ICONS } from "./icons";

const SHAPE_ICON: Record<FrameShapeId, string> = {
  round: ICONS.shapeRound,
  oval: ICONS.shapeOval,
  square: ICONS.shapeSquare,
};

/**
 * 共有キャンバス（眼鏡形状）の「見た目の設定」。フレームの形（丸眼鏡/楕円/
 * 長方形）と色（マット/べっ甲/クリア/木目）を1つにまとめた区画——以前は
 * 独立のトリガーボタン+ポップオーバーだったが、設定メニュー(SettingsMenu)の
 * 「見た目の設定」区画へ統合した(issue #154、ユーザー指示)。トリガー・開閉の
 * 概念は持たず、`element`を呼び出し元(main.ts)が設定メニューのスロットへ
 * そのまま差し込むだけの中身専用クラスになっている。
 */
export class AppearanceSelector {
  /** 呼び出し元(main.ts)がSettingsMenu.getAppearanceSlot()へ差し込む中身。
   *  共有タブを見ている間だけhidden=falseにする(main.tsのsetView参照)。 */
  readonly element: HTMLElement;

  private shapeId: FrameShapeId;
  private patternId: FramePatternId;
  private onShapeChange: (id: FrameShapeId) => void;
  private shapeButtons = new Map<FrameShapeId, HTMLButtonElement>();
  private patternPicker!: ReturnType<typeof buildFramePatternPicker>;

  /** 「メガネ2」(レンズ分割の2組目)専用の値・コールバック(issue #113④)。
   *  「メガネ1」(shapeId/patternId)とは別に個別調整できる——タブ(pairTabRow)で
   *  今どちらを編集中かを切り替え、形・色のボタン群自体はshapeButtons/
   *  patternButtonsを2組で共有する(activePairで表示先を切り替えるだけ)。 */
  private pair2ShapeId: FrameShapeId;
  private pair2PatternId: FramePatternId;
  private onPair2ShapeChange: (id: FrameShapeId) => void;
  private activePair: 0 | 1 = 0;
  private pairTabRow: HTMLElement;
  private pairTabButtons = new Map<0 | 1, HTMLButtonElement>();

  constructor(
    initialShapeId: FrameShapeId,
    initialPatternId: FramePatternId,
    onShapeChange: (id: FrameShapeId) => void,
    onPatternChange: (id: FramePatternId) => void,
    onPair2ShapeChange: (id: FrameShapeId) => void,
    onPair2PatternChange: (id: FramePatternId) => void
  ) {
    this.shapeId = initialShapeId;
    this.patternId = initialPatternId;
    this.onShapeChange = onShapeChange;
    this.pair2ShapeId = initialShapeId;
    this.pair2PatternId = initialPatternId;
    this.onPair2ShapeChange = onPair2ShapeChange;

    this.element = document.createElement("div");

    // 「メガネ1」「メガネ2」の切り替えタブ(issue #113④)。共同アイデア出し
    // フェーズ①でレンズ分割が2組になっている(3人以上参加)間だけ表示する
    // ——それ以外は共有キャンバス全体で1つの見た目しか無いため、タブ自体が
    // 意味を持たない(setPair2Visible参照)。
    this.pairTabRow = document.createElement("div");
    this.pairTabRow.className = "shared-menu-section appearance-pair-tabs";
    this.pairTabRow.hidden = true;
    const pairTabPill = document.createElement("div");
    pairTabPill.className = "toolbar-pill";
    for (const [pairIndex, label] of [
      [0, "メガネ1"],
      [1, "メガネ2"],
    ] as const) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn appearance-pair-tab-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => this.selectPair(pairIndex));
      this.pairTabButtons.set(pairIndex, btn);
      pairTabPill.appendChild(btn);
    }
    this.pairTabRow.appendChild(pairTabPill);
    this.element.appendChild(this.pairTabRow);

    const shapeSection = document.createElement("div");
    shapeSection.className = "shared-menu-section";
    const shapeLabel = document.createElement("div");
    shapeLabel.className = "shared-section-label";
    shapeLabel.textContent = "フレームの形";
    shapeSection.appendChild(shapeLabel);
    const shapeRow = document.createElement("div");
    shapeRow.className = "toolbar-pill";
    for (const id of FRAME_SHAPE_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", getFrameShape(id).label);
      btn.innerHTML = SHAPE_ICON[id];
      btn.addEventListener("click", () => this.selectShape(id));
      this.shapeButtons.set(id, btn);
      shapeRow.appendChild(btn);
    }
    shapeSection.appendChild(shapeRow);
    this.element.appendChild(shapeSection);

    // 「メガネ2」も同じピッカー(1個)を使い回す——タブ切り替え(selectPair)の
    // たびにsetValue()で表示中の組の値に差し替える(syncShapeと同じやり方)。
    // onSelectのコールバック自体はここで固定するが、中でthis.activePairを見て
    // メガネ1/2どちらの値・コールバックを使うか毎回判定する。
    this.patternPicker = buildFramePatternPicker(initialPatternId, (id) => {
      if (this.activePair === 1) {
        this.pair2PatternId = id;
        onPair2PatternChange(id);
        return;
      }
      this.patternId = id;
      onPatternChange(id);
    });
    this.element.appendChild(this.patternPicker.element);

    this.syncShape();
    this.syncPairTabs();
  }

  /** 「メガネ1」「メガネ2」タブの切り替え(issue #113④)。形・色のボタン群は
   *  共有なので、タブを切り替えるとその組の今の値に合わせて表示が変わる
   *  だけ——サーバーへの送信はここでは発生しない(ボタンを押した時のみ)。 */
  private selectPair(pairIndex: 0 | 1): void {
    if (pairIndex === this.activePair) return;
    this.activePair = pairIndex;
    this.syncShape();
    this.patternPicker.setValue(pairIndex === 1 ? this.pair2PatternId : this.patternId);
    this.syncPairTabs();
  }

  private selectShape(id: FrameShapeId): void {
    if (this.activePair === 1) {
      if (id === this.pair2ShapeId) return;
      this.pair2ShapeId = id;
      this.syncShape();
      this.onPair2ShapeChange(id);
      return;
    }
    if (id === this.shapeId) return;
    this.shapeId = id;
    this.syncShape();
    this.onShapeChange(id);
  }

  private syncShape(): void {
    const currentShapeId = this.activePair === 1 ? this.pair2ShapeId : this.shapeId;
    for (const [id, btn] of this.shapeButtons) {
      const active = id === currentShapeId;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }

  private syncPairTabs(): void {
    for (const [pairIndex, btn] of this.pairTabButtons) {
      const active = pairIndex === this.activePair;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }

  /** 共有ルームに接続中、編集できない間だけ呼ぶ（main.tsのframe()ループから
   *  毎フレーム呼んでよい——値が変わらない限りDOMは触らない）。編集可能な
   *  全ユーザーに開放されたため(issue #113④)、以前のようにルームマスター
   *  限定ではない。トリガー自体は開けたままにし、今の設定を見られるように
   *  する——押しても反映されないことはボタン自体のdisabled表示で伝える。
   *  タブ切り替え自体はロック中も可能にする(他の組の設定を見られるように)。 */
  setLocked(locked: boolean): void {
    for (const [, btn] of this.shapeButtons) btn.disabled = locked;
    this.patternPicker.setDisabled(locked);
  }

  /** 「メガネ2」タブ自体の表示/非表示(issue #113④)。共同アイデア出しフェーズ①で
   *  レンズ分割が2組になっている(3人以上参加)間だけmain.tsから呼ばれてtrueになる
   *  ——それ以外では共有キャンバス全体で1つの見た目しか無いため、タブが
   *  意味を持たない。非表示に戻る時、メガネ2を編集中だったら混乱を避けるため
   *  メガネ1表示へ戻す(でないと隠れたタブのままボタン操作がメガネ2へ送られ続ける)。 */
  setPair2Visible(visible: boolean): void {
    if (this.pairTabRow.hidden === !visible) return;
    this.pairTabRow.hidden = !visible;
    if (!visible && this.activePair !== 0) this.selectPair(0);
  }

  /** ルーム側の「メガネ1」の見た目（サーバーに保存された値）を反映する。
   *  ユーザー操作を経ないため、onShapeChange/onPatternChangeは呼ばない——呼ぶと
   *  自分が受け取った値をそのまま送り返すだけの無意味なPATCHが発生してしまう。 */
  setValues(shapeId: FrameShapeId, patternId: FramePatternId): void {
    if (shapeId !== this.shapeId) {
      this.shapeId = shapeId;
      if (this.activePair === 0) this.syncShape();
    }
    if (patternId !== this.patternId) {
      this.patternId = patternId;
      if (this.activePair === 0) this.patternPicker.setValue(patternId);
    }
  }

  /** setValuesの「メガネ2」版(issue #113④)。 */
  setPair2Values(shapeId: FrameShapeId, patternId: FramePatternId): void {
    if (shapeId !== this.pair2ShapeId) {
      this.pair2ShapeId = shapeId;
      if (this.activePair === 1) this.syncShape();
    }
    if (patternId !== this.pair2PatternId) {
      this.pair2PatternId = patternId;
      if (this.activePair === 1) this.patternPicker.setValue(patternId);
    }
  }
}
