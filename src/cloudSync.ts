import { _setApiTokenGetter, authFetch, isSignedIn } from "./apiClient";
import type { TokenGetter } from "./apiClient";
import { CLIENT_ID } from "./clientId";
import type { MemoOp } from "./memoStore";
import type { Memo } from "./types";

/**
 * ログイン中のアカウントにキャンバスの状態を紐づけるための、サーバー(api.onunu.me)との同期。
 *
 * スコープ（今回やること）:
 * - ログインしたら、そのアカウントに保存済みのキャンバスがあれば取得してローカルを上書きする。
 * - 保存済みがまだ無ければ、今のローカルの内容をそのままアップロードして初期バックアップにする。
 * - ログイン中の変更は、メモ単位でごく短くデバウンスしてサーバーに送る(issue #99)。
 * - 他タブ/他端末での変更はWebSocketで届くメモの中身をその場で反映する(realtimeSync.ts経由)。
 *   名前・見た目のような概念を持たない個人キャンバスでは、メモ単位のリアルタイム反映が
 *   主経路であり、フルGETでの取り込みは再接続直後のresyncだけで使う。
 *
 * 以前はメモ全件を2秒デバウンスでPUTし、WebSocket pingを受けてGETし直す方式だった。
 * 同じアカウントを複数タブ/端末で同時に開いて編集すると、後勝ちのPUTが先勝ちの変更ごと
 * 丸ごと踏みつぶす問題があった——共有キャンバス側(sharedCanvasSync.ts)と同じ原因・
 * 同じ解決方針で、メモ単位のPUT/DELETEに置き換えた。
 */

/** 1回のドラッグ中に連続して届くpushOp()呼び出しをまとめるための短いデバウンス。
 *  sharedCanvasSync.tsと同じ考え方・同じ値。 */
const PUSH_DEBOUNCE_MS = 200;

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushInFlight = false;
const pendingUpserts = new Map<string, Memo>();
const pendingDeletes = new Set<string>();

export function setTokenGetter(getter: TokenGetter | null): void {
  _setApiTokenGetter(getter);
  if (!getter && pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = undefined;
    pendingUpserts.clear();
    pendingDeletes.clear();
  }
}

/** サーバー側に保存済みのメモ一覧を取得する。まだ一度も保存したことが無い
 *  アカウントの場合はnullを返す（サーバー側がcanvas_stateの行の有無で判定する）。 */
async function pullCanvas(): Promise<Memo[] | null> {
  const res = await authFetch("/canvas");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`クラウドからの取得に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const memos = (data as { memos?: unknown }).memos;
  return Array.isArray(memos) ? (memos as Memo[]) : null;
}

/** メモ1件を保存する。X-Client-IdヘッダーはWebSocket経由で自分に跳ね返ってくる
 *  通知を無視するための識別子(clientId.ts参照、sharedCanvas.tsと同じ考え方)。 */
async function upsertCanvasMemo(memo: Memo): Promise<void> {
  const res = await authFetch(`/canvas/memos/${encodeURIComponent(memo.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID },
    body: JSON.stringify({ memo }),
  });
  if (!res.ok) throw new Error(`クラウドへの保存に失敗しました (status: ${res.status})`);
}

async function deleteCanvasMemo(memoId: string): Promise<void> {
  const res = await authFetch(`/canvas/memos/${encodeURIComponent(memoId)}`, {
    method: "DELETE",
    headers: { "X-Client-Id": CLIENT_ID },
  });
  if (!res.ok) throw new Error(`クラウドからの削除に失敗しました (status: ${res.status})`);
}

/** MemoStoreのonOpから呼ぶ。触れた/消したメモをまとめて短くデバウンスし、
 *  まとめてメモ単位のPUT/DELETEとして送る(sharedCanvasSync.pushOpと同じ設計)。 */
export function pushOp(op: MemoOp): void {
  if (!isSignedIn()) return;
  for (const memo of op.upserts) {
    pendingDeletes.delete(memo.id);
    pendingUpserts.set(memo.id, memo);
  }
  for (const id of op.deletes) {
    pendingUpserts.delete(id);
    pendingDeletes.add(id);
  }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    flush();
  }, PUSH_DEBOUNCE_MS);
}

function flush(): void {
  const upserts = Array.from(pendingUpserts.values());
  const deletes = Array.from(pendingDeletes);
  pendingUpserts.clear();
  pendingDeletes.clear();
  if (upserts.length === 0 && deletes.length === 0) return;
  pushInFlight = true;
  const requests = [...upserts.map((memo) => upsertCanvasMemo(memo)), ...deletes.map((id) => deleteCanvasMemo(id))];
  void Promise.all(requests)
    .catch((e) => {
      console.error("[cloudSync] push failed", e);
    })
    .finally(() => {
      pushInFlight = false;
    });
}

/** ローカルにまだサーバーへ送信していない変更が残っているか（送信待ち、または送信中）。 */
export function hasPendingLocalChanges(): boolean {
  return pushTimer !== undefined || pushInFlight;
}

interface CanvasStore {
  getAll(): readonly Memo[];
  replaceAll(memos: Memo[]): void;
  applyRemoteUpsert(memo: Memo): void;
  applyRemoteDelete(memoId: string): void;
}

export async function syncOnSignIn(store: CanvasStore): Promise<void> {
  try {
    const remote = await pullCanvas();
    if (remote) {
      store.replaceAll(remote);
    } else {
      // このアカウントではまだ一度も保存したことが無い。今のローカルの内容を
      // メモ単位でアップロードし、以後の同期の初期状態にする（issue #99前は
      // 全件PUT1回だったが、以後はサーバー側もメモ単位の行しか持たないため）。
      await Promise.all(store.getAll().map((memo) => upsertCanvasMemo(memo)));
    }
  } catch (e) {
    console.error("[cloudSync] initial sync failed", e);
  }
}

/**
 * realtimeSync.tsの再接続直後(onReconnected)に呼ぶ、取得のみの再同期。
 * WS接続中はメモ単位のリアルタイム反映(onPersonalMemoUpserted/Deleted)が
 * 主経路のため、これは「切断していた間に取りこぼした変更を拾い直す」保険
 * （issue #79と同じ考え方）。
 */
export async function refreshFromCloud(store: CanvasStore): Promise<void> {
  if (hasPendingLocalChanges()) {
    console.log("[cloudSync] refresh skipped: local changes pending");
    return;
  }
  try {
    const remote = await pullCanvas();
    if (remote) store.replaceAll(remote);
  } catch (e) {
    console.error("[cloudSync] refresh failed", e);
  }
}
