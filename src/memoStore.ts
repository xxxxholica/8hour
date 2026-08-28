import { computeOpacity, MS_PER_DAY, remainingMs, STANDARD_LIFESPAN_DAYS } from "./fade";
import { circleIntersectsBox, clampToCircle, eraseFromStroke, isInsideClamp, restrictTranslation } from "./geometry";
import { loadMemos, saveMemos } from "./storage";
import { LINE_HEIGHT_MULTIPLIER } from "./textLayout";
import type { LifespanDays, Memo, MemoStyle, Point, Stroke, TextMemo } from "./types";

function makeId(): string {
  return `memo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 1回の更新系メソッド呼び出しで生じた変更を表す、メモ単位の操作。共有キャンバスの
 *  同期(sharedCanvasSync.ts)が、メモ全件ではなくこの単位でサーバーに送るために使う。 */
export interface MemoOp {
  upserts: Memo[];
  deletes: string[];
}

/** undo履歴に積むスナップショットの上限。無制限に積み続けるとメモリを圧迫する
 *  ため、一定数を超えたら一番古いものから捨てる（issue #89：「入力ミスをした
 *  直後の数秒間」を取り消せれば十分、という要求なのでlocalStorageへの永続化は
 *  せず、ページを再読み込みすれば履歴は消える簡易版でよい）。 */
const MAX_UNDO_HISTORY = 50;

/**
 * メモ全体の状態を保持し、既定ではlocalStorageと同期させるストア。
 * 保存・復元・経時フェードの判定・なぞり復活・全体リセットをまとめて担う。
 */
export class MemoStore {
  private memos: Memo[];
  private onChange?: (memos: readonly Memo[]) => void;
  /** 共有キャンバス専用: 更新系メソッドが変更したメモ単位の操作を通知するフック
   *  (sharedCanvasSync.tsのpushOp)。onChangeと違い、メモ全件ではなく触れた/消した
   *  メモだけを渡す——サーバー側もメモ単位でupsert/deleteできるようになったため
   *  (issue #99)。個人用ストア(main.ts)は渡さない。 */
  private onOp?: (op: MemoOp) => void;
  private persistLocally: boolean;
  /** undo/redo用の完全スナップショット履歴（issue #89）。個々の操作の逆処理を
   *  操作ごとに書く（コマンドパターン）のではなく、操作の直前の全メモ配列を
   *  丸ごと複製して積む方式にした——描画・消去・移動・テキスト編集など操作の
   *  種類が多く、それぞれに逆操作を実装するとバグの温床になりやすい一方、
   *  メモ配列はそのままlocalStorageに保存できる程度に軽い（JSON化可能な）
   *  データなので、丸ごと複製するコストは許容できる。ページを再読み込みすれば
   *  消える前提（localStorageには保存しない）のため、量が増えすぎないよう
   *  MAX_UNDO_HISTORY件で古いものから捨てる。 */
  private undoStack: Memo[][] = [];
  private redoStack: Memo[][] = [];

  /**
   * onChangeは、アカウント同期（cloudSync.ts）がローカルの変更をクラウドに
   * 反映するためのフック。ログインしていない間は呼ばれても何もしない。
   * persistLocallyをfalseにすると、localStorage["memos"]を一切読み書きしない
   * （個人用ストアと衝突させたくない共有キャンバス用インスタンス、
   * sharedCanvasSync.ts参照——真の保存先はサーバー側のため、ここでは何も保存しない）。
   */
  constructor(
    onChange?: (memos: readonly Memo[]) => void,
    persistLocally: boolean = true,
    onOp?: (op: MemoOp) => void
  ) {
    this.persistLocally = persistLocally;
    this.memos = persistLocally ? loadMemos() : [];
    this.onChange = onChange;
    this.onOp = onOp;
  }

  private persist(): void {
    if (this.persistLocally) saveMemos(this.memos);
    this.onChange?.(this.memos);
  }

  private emitOp(op: MemoOp): void {
    if (op.upserts.length === 0 && op.deletes.length === 0) return;
    this.onOp?.(op);
  }

  /**
   * これから始まる一連の操作（1回のドラッグでの描画・消去・移動・振り回し、
   * または1回のテキスト編集セッション全体）の直前の状態を、undo履歴に積む。
   * 呼び出し側（canvasView.ts）が、ジェスチャー中で最初にストアを書き換える
   * 直前に1回だけ呼ぶ責任を持つ——ポインタが動くたびに何度も呼ぶと、1回の
   * ドラッグが何十もの細かいundoステップに分かれてしまい「直前の操作を戻す」
   * という直感に合わなくなるため。新しい操作が始まった時点でredo履歴は
   * 無効になる（一般的なundo/redoの挙動）。
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
    const before = this.memos;
    this.memos = prev;
    this.persist();
    this.emitOp(this.diffForOp(before, this.memos));
    return true;
  }

  /** undoで取り消した操作をやり直す。やり直せる操作が無ければ何もしない。 */
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(structuredClone(this.memos));
    const before = this.memos;
    this.memos = next;
    this.persist();
    this.emitOp(this.diffForOp(before, this.memos));
    return true;
  }

  /** undo/redoによるスナップショット切り替え専用: 差し替え前後のメモ配列を比べて、
   *  共有キャンバスに送るべきupsert/delete opを組み立てる。undo/redoスタックは
   *  スナップショット時刻ごとに別々にstructuredCloneした配列なので、内容が同じ
   *  メモでもオブジェクトの参照は常に変わる——「本当に内容が変わったメモだけ」を
   *  厳密に見分けることはせず、切り替え後に残っている全メモをupsert対象として
   *  扱う（undo/redoは頻度の低い操作なので、多少余分なPUTが飛んでも実害はない）。 */
  private diffForOp(before: Memo[], after: Memo[]): MemoOp {
    const afterIds = new Set(after.map((m) => m.id));
    const deletes = before.filter((m) => !afterIds.has(m.id)).map((m) => m.id);
    return { upserts: after, deletes };
  }

  /**
   * クラウド（またはルームのサーバー側の内容）で丸ごと置き換える（アカウントログイン時や
   * 共有キャンバスのポーリング同期用）。ローカルの変更点だけを賢く合成するような処理はせず、
   * 常にサーバー側を正として上書きする——複数端末/複数人での本格的な競合解決は今回のスコープ外。
   * 置き換え前のundo/redo履歴は、置き換え後の内容とは無関係な状態を指すことになるため破棄する
   * ——履歴を残したままだと、undoで別の同期タイミングの内容に飛んでしまい混乱する。
   */
  replaceAll(memos: Memo[]): void {
    this.memos = memos;
    this.undoStack = [];
    this.redoStack = [];
    if (this.persistLocally) saveMemos(this.memos);
    // 取り込んだ直後にそのまま押し戻す(onChange経由の再送信)必要はないため、
    // ここではpersist()を経由せずonChangeを呼ばない。
  }

  /** 共有キャンバス専用: WebSocketで届いた他メンバーのメモ1件を取り込む
   *  (sharedCanvasSync.ts)。replaceAllと同じく「取り込んだ内容をそのまま押し戻す」
   *  必要はないのでpersist/onChange/onOpは一切経由しない。undo/redo履歴は
   *  replaceAllと違い破棄しない——他人が別のメモに加えた変更のたびに自分の
   *  undo履歴が消えてしまうと使い物にならないため（差分は1メモだけなので、
   *  undo履歴側の多少の食い違いは実害が小さい）。 */
  applyRemoteUpsert(memo: Memo): void {
    const idx = this.memos.findIndex((m) => m.id === memo.id);
    if (idx === -1) this.memos.push(memo);
    else this.memos[idx] = memo;
    if (this.persistLocally) saveMemos(this.memos);
  }

  /** applyRemoteUpsertの削除版。 */
  applyRemoteDelete(memoId: string): void {
    this.memos = this.memos.filter((m) => m.id !== memoId);
    if (this.persistLocally) saveMemos(this.memos);
  }

  getAll(): readonly Memo[] {
    return this.memos;
  }

  /** 共有キャンバスの投票フェーズ専用: 1件のメモのheatだけをサーバー側の値
   *  （楽観的な+1、またはheat-changed通知/APIレスポンスでの確定値）で直接
   *  書き換える。replaceAllと同じく、取り込んだ内容をそのまま押し戻す必要は
   *  ないためpersist/onChangeは経由しない。 */
  setMemoHeat(memoId: string, heat: number): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo) return;
    memo.heat = heat;
  }

  getActive(): Memo[] {
    return this.memos.filter((m) => m.status === "active");
  }

  /** 振り返りビュー用: 消滅済みメモを作成日時の昇順で返す。 */
  getFaded(): Memo[] {
    return this.memos
      .filter((m) => m.status === "faded")
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** 新しい手描きメモを1点で開始する（最初のストロークはこの直後に addPointToStroke で積む）。 */
  createMemo(start: Point, style: MemoStyle, now: number = Date.now()): Memo {
    const memo: Memo = {
      id: makeId(),
      kind: "stroke",
      x: start.x,
      y: start.y,
      strokes: [[start]],
      createdAt: now,
      lastTracedAt: now,
      traceHistory: [now],
      lifespanDays: style.lifespanDays,
      status: "active",
      tool: style.tool,
      color: style.color,
      lineWidth: style.lineWidth,
    };
    this.memos.push(memo);
    this.persist();
    this.emitOp({ upserts: [memo], deletes: [] });
    return memo;
  }

  /**
   * 新しいテキストメモを作る。折り返し済みの行(textLines)とボックスサイズ(boxWidth/boxHeight)は
   * 呼び出し側（textLayout.ts の wrapTextAtReferenceScale / normalizedBoxSize）で計算済みのものを渡す
   * ——テキストの折り返しにはcanvasのフォント計測が必要で、ストアはcanvas contextを持たないため。
   */
  createTextMemo(
    anchor: Point,
    text: string,
    textLines: string[],
    fontSize: number,
    boxWidth: number,
    boxHeight: number,
    style: { color: string; lifespanDays: LifespanDays; align?: "center" | "left"; lineHeight?: number },
    now: number = Date.now()
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
      lastTracedAt: now,
      traceHistory: [now],
      lifespanDays: style.lifespanDays,
      status: "active",
      color: style.color,
      align: style.align ?? "center",
      lineHeight: style.lineHeight ?? LINE_HEIGHT_MULTIPLIER,
    };
    this.memos.push(memo);
    this.persist();
    this.emitOp({ upserts: [memo], deletes: [] });
    return memo;
  }

  /** 既存メモに新しいストロークを1本追加する（ペンを持ち上げて再度書き始めたとき）。手描きメモにのみ有効。 */
  startStroke(memoId: string, start: Point): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.kind !== "stroke") return;
    memo.strokes.push([start]);
    this.persist();
    this.emitOp({ upserts: [memo], deletes: [] });
  }

  /** 直近のストロークに点を追加する。手描きメモにのみ有効。 */
  addPointToLastStroke(memoId: string, point: Point): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.kind !== "stroke" || memo.strokes.length === 0) return;
    const stroke: Stroke = memo.strokes[memo.strokes.length - 1];
    stroke.push(point);
    this.persist();
    this.emitOp({ upserts: [memo], deletes: [] });
  }

  /**
   * ドラッグせずに離した（＝直近のストロークが1点のまま）場合の後始末。
   * その1点だけのストロークは描画側（renderMemoAt）で無視され画面には何も
   * 残らないが、ストアには「メモがある」状態が残ってしまい、メモ0件のときだけ
   * 出す初期案内（自由に書いてみる／テンプレートを使用）が誤って
   * 出なくなってしまう（ユーザー報告）。そのストロークが唯一のストローク
   * ならメモ自体を削除し、他に有効なストロークが既にある（＝同じ書き込み
   * セッション中に一度書いた後、ペンを持ち上げてもう一度一瞬だけ触れた場合）
   * ならその1点だけのストロークだけを取り除く。
   */
  /** 戻り値はメモ自体を削除したかどうか（呼び出し側でactiveMemoIdの後始末に使う）。 */
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
    this.emitOp({ upserts: [memo], deletes: [] });
    return false;
  }

  /**
   * なぞって復活: 1回で戻せる量は「寿命(lifespanDays)の15%ぶん・今との差
   * （経過時間）」のうち小さいほう。後者が必要なのは、既にほぼ100%近い
   * 状態でなぞった場合に、経過時間が0未満に（＝まだ来ていない時刻を
   * 経過済み扱いに）ならないようにするため。
   * 以前は「なぞればいつまでも際限なく復活できてしまう」ことへの歯止めとして
   * クールタイムを設けていたが（Issue #11）、「消えるまでの期間」自体が
   * 1日固定になった今（FIXED_LIFESPAN_DAYS）、そもそも1メモが生き延びられる
   * 期間に上限があるため、復活の頻度を別途制限する理由がなくなった
   * （ユーザー指示：制限を撤廃し、自由に時間を進める・戻すができるように）。
   */
  reviveMemo(memoId: string, now: number = Date.now()): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.status !== "active") return;
    const lifespanMs = (memo.lifespanDays ?? STANDARD_LIFESPAN_DAYS) * MS_PER_DAY;
    const grantMs = Math.min(lifespanMs * 0.15, Math.max(0, now - memo.lastTracedAt));
    if (grantMs <= 0) return; // 既に「今」に追いついている（これ以上経過時間を削れない）
    memo.lastTracedAt += grantMs;
    memo.traceHistory.push(memo.lastTracedAt);
    this.persist();
    this.emitOp({ upserts: [memo], deletes: [] });
  }

  /**
   * 選択道具でメモを掴んで振り回す操作専用: lastTracedAtをdeltaMsだけ
   * 直接ずらす（負で過去側＝経過時間が増える＝時間を進める、正で「今」に
   * 近づく側＝復活。canvasView.tsのupdateRotationGesture参照）。
   * なぞって復活（reviveMemo）と違い、寿命に
   * 対する割合ではなく絶対量（1回転=1時間、ユーザー指示）で、cap・
   * クールタイムのどちらも設けない——振り回している間は自由に行き来できる。
   * 振り回しは「なぞった」わけではないので、traceHistory（振り返り用の履歴、
   * 昇順が前提）には残さない——translateMemoが位置移動をlastTracedAt/
   * traceHistoryと無関係に扱うのと同じ考え方。
   */
  nudgeMemoClock(memoId: string, deltaMs: number): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.status !== "active") return;
    memo.lastTracedAt += deltaMs;
    this.persist();
    this.emitOp({ upserts: [memo], deletes: [] });
  }

  /** なぞって復活の状態（View用）。現時点で消滅までにかかる残り時間(ms)と、
   *  比率表示（バー）用の基準となる寿命そのもの(ms)を返す——「なぞる」「移動」
   *  道具でメモに触れている間・（PCでは）ホバーしている間の案内表示
   *  （canvasView.ts）に使う。存在しない/非活性なメモの場合はnull。 */
  reviveStatusOf(memoId: string, now: number = Date.now()): { remainingMs: number; lifespanMs: number } | null {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.status !== "active") return null;
    const lifespanMs = (memo.lifespanDays ?? STANDARD_LIFESPAN_DAYS) * MS_PER_DAY;
    return { remainingMs: remainingMs(now - memo.lastTracedAt, memo.lifespanDays), lifespanMs };
  }

  /**
   * 既存のテキストメモの内容を書き換える（テキストの編集機能）。フォントサイズ・色・
   * 消えるまでの期間は変更しない（内容を編集する操作であって、見た目の再設定ではないため）。
   * ペン/マーカーで既存メモに重ねて描画しても復活しないのと同様、テキストの編集も
   * lastTracedAt/traceHistoryには一切触れない（時間の変更はしない——ユーザー指示）。
   * 時間を戻したい場合は専用の「なぞる」道具（reviveMemo）を使う。
   */
  updateTextMemo(memoId: string, text: string, textLines: string[], boxWidth: number, boxHeight: number): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.kind !== "text" || memo.status !== "active") return;
    memo.text = text;
    memo.textLines = textLines;
    memo.boxWidth = boxWidth;
    memo.boxHeight = boxHeight;
    this.persist();
    this.emitOp({ upserts: [memo], deletes: [] });
  }

  /** メモを1件削除する（テキスト編集で全文を消して確定した場合など）。 */
  deleteMemo(memoId: string): void {
    const before = this.memos.length;
    this.memos = this.memos.filter((m) => m.id !== memoId);
    if (this.memos.length !== before) {
      this.persist();
      this.emitOp({ upserts: [], deletes: [memoId] });
    }
  }

  /**
   * メモ全体（手描き・テキストどちらも）を (dx, dy) だけ平行移動する
   * （移動道具でドラッグしている間、ポインタが動くたびに呼ばれる差分移動）。
   * 描画可能領域の外にはみ出す移動は許さない——手描き(stroke)は、各点を
   * 独立にclampして境界へスナップするのではなく、restrictTranslationで
   * ストロークを構成する全ての点が境界内に収まる範囲まで移動量そのものを
   * 比例的に縮める（剛体移動）。点ごとにクランプする方式は、境界に近い点
   * ほど個別に丸め込まれて線の形が歪んでしまう問題があったため、この方式に
   * 変更した（ユーザー指示：移動そのものを制限し、ストローク全体が常に
   * 境界内に収まるようにする）。テキストは代表点(x, y)が箱の中心なので、
   * 中心点だけをclampすると箱の端（±boxWidth/2, ±boxHeight/2）が境界の外に
   * はみ出せてしまう（ユーザー指摘：移動中にテキストが枠外に出る）。そのため
   * 箱の四隅を点群としてrestrictTranslationに渡し、四隅すべてが境界内に
   * 収まる範囲まで移動量を縮める。ただし四隅が最初から境界内に収まっていない
   * （箱そのものが枠に対して大きすぎる）場合は、restrictTranslationが常に
   * 移動量0を返して動かせなくなってしまうため、その場合だけ従来通り中心点の
   * clampにフォールバックする（はみ出しは避けられないが、動かせないよりはよい）。
   * 既定のclampは半径1の円だが、SMUIのように選んだフレーム形状（楕円/長方形）
   * の輪郭でクランプしたい呼び出し元はframeShape.tsの対応するclampを渡す
   * ——このストア自体は「今どの形状を見ているか」を知らない（同じ個人
   * MemoStoreが、常に円の「キャンバス」タブと形状を選べるSMUIの左レンズの
   * 両方から使われるため、ストアの状態としては持てない）。
   * 移動は「消えるまでの期間」や「なぞって復活」とは無関係な、位置だけの
   * 操作として扱う。よって lastTracedAt / traceHistory には触れない
   * ——ただ場所を直しただけで内容に触れたわけではない、という判断。
   */
  translateMemo(
    memoId: string,
    dx: number,
    dy: number,
    clamp: (p: Point) => Point = (p) => clampToCircle(p, 1)
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
      const halfW = memo.boxWidth / 2;
      const halfH = memo.boxHeight / 2;
      const corners: Point[] = [
        { x: memo.x - halfW, y: memo.y - halfH },
        { x: memo.x + halfW, y: memo.y - halfH },
        { x: memo.x - halfW, y: memo.y + halfH },
        { x: memo.x + halfW, y: memo.y + halfH },
      ];
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
    this.emitOp({ upserts: [memo], deletes: [] });
  }

  /**
   * 全アクティブメモの不透明度を再計算し、猶予切れのものを faded に変更する。
   * 呼び出すたびに persist するのはコストが高いので、状態が変化した時だけ保存する。
   */
  tick(now: number = Date.now()): boolean {
    let changed = false;
    const upserts: Memo[] = [];
    for (const memo of this.memos) {
      // 投票が確定(fadeExempt)したメモは、時間経過フェードの対象から恒久的に外れる
      // ——確定した濃さのまま留まるという仕様のため。
      if (memo.status !== "active" || memo.fadeExempt) continue;
      const elapsed = now - memo.lastTracedAt;
      const opacity = computeOpacity(elapsed, memo.lifespanDays);
      if (opacity === 0) {
        memo.status = "faded";
        changed = true;
        upserts.push(memo);
      }
    }
    if (changed) {
      this.persist();
      this.emitOp({ upserts, deletes: [] });
    }
    return changed;
  }

  /** 現在時刻を基準にした、アクティブメモの不透明度スナップショット。描画専用。 */
  opacityOf(memo: Memo, now: number = Date.now()): number {
    if (memo.fadeExempt) return memo.frozenDensity ?? 1;
    return computeOpacity(now - memo.lastTracedAt, memo.lifespanDays);
  }

  resetAll(): void {
    this.memos = [];
    this.undoStack = [];
    this.redoStack = [];
    this.persist();
  }

  /**
   * 消しゴム: center から radius 以内をアクティブなメモから削除する（本当の手動削除）。
   * 手描きメモはストロークが分断される場合は複数本に分け、全て消えたメモは配列から取り除く。
   * テキストメモは部分削除ができないため、当たり判定用のボックス(boxWidth/boxHeight)に
   * 触れたらメモごと削除する。消滅済み（振り返りビューにある）メモには影響しない。
   */
  eraseAt(center: Point, radius: number): boolean {
    let changed = false;
    const upserts: Memo[] = [];
    const deletes: string[] = [];
    this.memos = this.memos.filter((memo) => {
      if (memo.status !== "active") return true;

      if (memo.kind === "text") {
        const touched = circleIntersectsBox(center, radius, {
          x: memo.x,
          y: memo.y,
          width: memo.boxWidth,
          height: memo.boxHeight,
        });
        if (touched) {
          changed = true;
          deletes.push(memo.id);
        }
        return !touched;
      }

      const newStrokes = memo.strokes.flatMap((s) => eraseFromStroke(s, center, radius));
      const strokeCountChanged =
        newStrokes.length !== memo.strokes.length ||
        newStrokes.some((s, i) => s.length !== memo.strokes[i]?.length);
      if (strokeCountChanged) changed = true;
      memo.strokes = newStrokes;
      if (newStrokes.length > 0) {
        if (strokeCountChanged) upserts.push(memo);
        return true;
      }
      if (strokeCountChanged) deletes.push(memo.id);
      return false;
    });
    if (changed) {
      this.persist();
      this.emitOp({ upserts, deletes });
    }
    return changed;
  }
}
