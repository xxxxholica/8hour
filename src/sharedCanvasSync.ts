import { deleteSharedMemo, getSharedCanvas, upsertSharedMemo } from "./sharedCanvas";
import type { SessionState, SharedCanvasDetail } from "./sharedCanvas";
import type { MemoOp } from "./memoStore";
import type { Memo } from "./types";

/** GET経由の変更検知で見るべき部分だけを取り出す。ownerId等は対象外
 *  （実質不変のため）。sessionは別途onSessionSeenで毎回渡すためここでは扱わない。
 *  frameShapeId2/framePatternId2は「メガネ2」専用の見た目の手動上書き
 *  (issue #113④)——これだけが変わった場合も変更として検知できるよう含める。 */
function syncKey(
  detail: Pick<SharedCanvasDetail, "memos" | "frameShapeId" | "framePatternId" | "frameShapeId2" | "framePatternId2">
): string {
  return JSON.stringify({
    memos: detail.memos,
    frameShapeId: detail.frameShapeId,
    framePatternId: detail.framePatternId,
    frameShapeId2: detail.frameShapeId2,
    framePatternId2: detail.framePatternId2,
  });
}

/** 1回のドラッグ中に連続して届くpushOp()呼び出しをまとめるための短いデバウンス。
 *  以前(全件PUT時代)の2秒より大幅に短い——メモ単位のPUTになったことで1回の
 *  送信サイズが小さくなり、頻繁に送っても負荷が小さいため(issue #99)。 */
const PUSH_DEBOUNCE_MS = 200;

/**
 * 1つのルーム（共有キャンバス）に対する、書き込み(メモ単位のPUT/DELETE)の
 * デバウンス送信と、他メンバーの変更取り込みをまとめて担う。
 *
 * メモの中身そのものはWebSocketの{type:"memo-upserted"/"memo-deleted"}通知
 * (realtimeSync.ts経由でSmuiViewが受け取り、sharedStore.applyRemoteUpsert/
 * applyRemoteDeleteへ直接反映する)でリアルタイムに同期する。ここでのpoll()
 * （GETでの全件取得し直し）は、名前・見た目の変更や投票フェーズ確定時の
 * {type:"changed"}ping、および再接続直後のresyncでのみ使う保険的な経路
 * （issue #79の設計をそのまま踏襲）。定期ポーリングは持たない。
 *
 * 競合解決は「そのメモを最後に保存した内容が勝つ」単純な方式のまま(メモ単位に
 * なった分、キャンバス単位の全件上書きより粒度が細かくなっている)。
 */
export class SharedRoomSync {
  private id: string;
  private onRemoteChange: (detail: SharedCanvasDetail) => void;
  private onSessionSeen: (session: SessionState | null) => void;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private pushInFlight = false;
  /** 直近のpushOp()で溜まった、まだ送っていない変更。メモIDごとに「直近の
   *  upsert or delete」だけを残す(同じメモへの連続した変更は最後の1回分だけ
   *  送れば十分なため)。 */
  private pendingUpserts = new Map<string, Memo>();
  private pendingDeletes = new Set<string>();
  /** poll()の多重実行防止。WebSocket通知は短時間に連続で届き得るため、
   *  前回のGETがまだ終わっていない間に来た通知は無視する（flush側の
   *  pushInFlightと同じ考え方）。 */
  private pollInFlight = false;
  /** 自分が最後に取得した内容。pollがそのまま拾い直して二重に反映して
   *  しまわないための判定に使う。 */
  private lastSyncedJson: string | null = null;

  constructor(
    id: string,
    onRemoteChange: (detail: SharedCanvasDetail) => void,
    onSessionSeen: (session: SessionState | null) => void
  ) {
    this.id = id;
    this.onRemoteChange = onRemoteChange;
    this.onSessionSeen = onSessionSeen;
  }

  /** 初回ハイドレート直後など、今の内容をpush不要の「同期済み」として記録しておく。 */
  markSynced(
    detail: Pick<SharedCanvasDetail, "memos" | "frameShapeId" | "framePatternId" | "frameShapeId2" | "framePatternId2">
  ): void {
    this.lastSyncedJson = syncKey(detail);
  }

  /** ルームを離れる／切り替える時の完全停止。デバウンス中の未送信変更も
   *  破棄する——ここで待たずに確実に止める。 */
  stop(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = undefined;
    this.pendingUpserts.clear();
    this.pendingDeletes.clear();
  }

  private hasPendingLocalChanges(): boolean {
    return this.pushTimer !== undefined || this.pushInFlight;
  }

  /** WebSocketの「変わった」通知、または再接続直後のresyncで呼ぶ。
   *  force=trueは、ローカルの未送信push(hasPendingLocalChanges)があっても
   *  待たせず取得する——投票フェーズ終了直後、確定したfadeExempt/frozenDensity
   *  をすぐ反映させたい呼び出し元(smuiView.ts)用。heat/fadeExempt/frozenDensity
   *  はサーバー側のPUTハンドラがクライアントの送信内容によらず常に上書きする
   *  値なので、pushが同時に飛んでいてもこの3フィールドを壊す心配はない。 */
  pollNow(force = false): void {
    void this.poll(force);
  }

  /** MemoStoreのonOpから呼ぶ。触れた/消したメモをまとめて短くデバウンスし、
   *  まとめてメモ単位のPUT/DELETEとして送る。 */
  pushOp(op: MemoOp): void {
    for (const memo of op.upserts) {
      this.pendingDeletes.delete(memo.id);
      this.pendingUpserts.set(memo.id, memo);
    }
    for (const id of op.deletes) {
      this.pendingUpserts.delete(id);
      this.pendingDeletes.add(id);
    }
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined;
      this.flush();
    }, PUSH_DEBOUNCE_MS);
  }

  private flush(): void {
    const upserts = Array.from(this.pendingUpserts.values());
    const deletes = Array.from(this.pendingDeletes);
    this.pendingUpserts.clear();
    this.pendingDeletes.clear();
    if (upserts.length === 0 && deletes.length === 0) return;
    this.pushInFlight = true;
    const requests = [
      ...upserts.map((memo) => upsertSharedMemo(this.id, memo)),
      ...deletes.map((memoId) => deleteSharedMemo(this.id, memoId)),
    ];
    void Promise.all(requests)
      .catch((e) => {
        console.error("[sharedCanvasSync] push failed", e);
      })
      .finally(() => {
        this.pushInFlight = false;
      });
  }

  private async poll(force = false): Promise<void> {
    if ((this.hasPendingLocalChanges() && !force) || this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const detail = await getSharedCanvas(this.id);
      // sessionはmemos/frameの変化と無関係に、取得するたびに毎回通知する
      // （WS通知の取りこぼし時にセッションのフェーズ状態を復旧できるのは
      // この経路だけのため、syncKeyの差分判定の対象外にしてある）。
      this.onSessionSeen(detail.session);
      const json = syncKey(detail);
      if (json === this.lastSyncedJson) return;
      this.lastSyncedJson = json;
      this.onRemoteChange(detail);
    } catch (e) {
      console.error("[sharedCanvasSync] poll failed", e);
    } finally {
      this.pollInFlight = false;
    }
  }
}
