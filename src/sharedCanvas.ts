import { authFetch } from "./apiClient";
import { CLIENT_ID } from "./clientId";
import { FRAME_PATTERN_ORDER } from "./framePattern";
import type { FramePatternId } from "./framePattern";
import { FRAME_SHAPE_ORDER } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import type { Memo } from "./types";

/**
 * 共有キャンバス（コラボ機能）のAPI呼び出し。api.onunu.me の /shared-canvases 系。
 * すべてのエンドポイントで Authorization ヘッダーが必須のため、未ログイン時は
 * 呼び出し元（smuiView.ts）でガードすること。
 *
 * 作成・参加・一覧・閲覧・退出・名前変更に加え、メモ単位のupsert/delete保存も行う
 * （SMUIの右レンズで実際に書き込めるようにするため）。以前はメモ全件をPUTで丸ごと
 * 上書きしていたが、2人が別々のメモを同時に編集すると後勝ちが先勝ちを踏みつぶす
 * 問題があった(issue #99)ため、メモ単位のエンドポイントに分けた——競合解決は
 * 依然として「そのメモを最後に保存した内容が勝つ」単純な方式のままだが、単位が
 * メモ1件になったことで別々のメモへの同時編集は互いを踏みつぶさなくなる。
 */

export interface SharedCanvasSummary {
  id: string;
  /** ルームの名前。未設定はnull（バックエンド仕様、2026-08-24からPATCHで保存可能に）。 */
  name: string | null;
  /** ルームマスターのuserId。招待リンク発行時、自分がオーナーかどうかの判定に使う(issue #79)。 */
  ownerId: string;
}

/** 進行中の「共同アイデア出し」セッションの状態（未開始の間はnull）。
 *  "results"は投票終了後の結果ロック(issue #114/#119の流れを受けたユーザー指示):
 *  メモの濃さは確定済みだが、オーナーが明示的にresumeSessionを呼ぶまで全員が
 *  読み取り専用のまま留まる。 */
export interface SessionState {
  phase: "ideation" | "discussion" | "voting" | "results";
  /** このフェーズが自動的に次へ進む予定時刻(ms epoch)。ルームマスターの延長操作で伸びる。 */
  phaseEndsAt: number;
  phase1Ms: number;
  phase2Ms: number;
  phase3Ms: number;
  maxParticipants: number;
  /** フェーズ①用に自分に払い出された色インデックス。未割当(色プール枯渇時)はnull。 */
  myColorIndex: number | null;
  /** 現在誰かに割り当て済みのレンズ番号一覧(issue #119: 参加者のいない空きレンズを
   *  グレーアウト表示するため)。0..LENS_COUNT-1の範囲外の値は含まれない想定だが、
   *  フロント側でも念のためlensSplit.ts側でLENS_COUNT未満だけを見る。 */
  occupiedLensIndexes: number[];
}

export interface SharedCanvasDetail {
  id: string;
  /** ルームの作成者=ルームマスター。セッションの開始・進行操作が行えるかの判定に使う。 */
  ownerId: string;
  memos: Memo[];
  session: SessionState | null;
  /** 「メガネ1」(レンズ分割無効時は共有キャンバス全体)の見た目(フレームの形・柄)。
   *  未設定(null)の間は呼び出し元(smuiView.ts)がローカルの既定値を使う。 */
  frameShapeId: FrameShapeId | null;
  framePatternId: FramePatternId | null;
  /** 「メガネ2」(レンズ分割の2組目)専用の見た目の手動上書き(issue #113④)。
   *  未設定(null)の間は呼び出し元(frameGeometry.ts)が自動ローテーション
   *  (issue #113③)にフォールバックする。 */
  frameShapeId2: FrameShapeId | null;
  framePatternId2: FramePatternId | null;
}

/** 新しい共有キャンバスを作る。作った本人がownerメンバーになる。ルームIDを返す。 */
export async function createSharedCanvas(): Promise<string> {
  const res = await authFetch("/shared-canvases", { method: "POST" });
  if (!res.ok) throw new Error(`共有キャンバスの作成に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const id = (data as { id?: unknown }).id;
  if (typeof id !== "string") throw new Error("サーバーの応答にidが含まれていません");
  return id;
}

/** 自分が参加中の共有キャンバス一覧。 */
export async function listSharedCanvases(): Promise<SharedCanvasSummary[]> {
  const res = await authFetch("/shared-canvases");
  if (!res.ok) throw new Error(`共有キャンバス一覧の取得に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const raw = Array.isArray(data) ? data : (data as { canvases?: unknown }).canvases;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is { id: string; name?: unknown; owner_id?: unknown } =>
        typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string"
    )
    .map((item) => ({
      id: item.id,
      name: typeof item.name === "string" ? item.name : null,
      ownerId: typeof item.owner_id === "string" ? item.owner_id : "",
    }));
}

/** ルームマスターが招待リンク用のトークンを発行する(issue #79)。ログイン不要の
 *  ゲスト参加リンクに埋め込む——ルームマスター以外は403で失敗する。 */
export async function mintInvite(id: string): Promise<{ token: string; expiresAt: number }> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/invite`, { method: "POST" });
  if (!res.ok) throw new Error(`招待リンクの発行に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const token = (data as { token?: unknown }).token;
  const expiresAt = (data as { expiresAt?: unknown }).expiresAt;
  if (typeof token !== "string") throw new Error("サーバーの応答にtokenが含まれていません");
  return { token, expiresAt: typeof expiresAt === "number" ? expiresAt : Date.now() };
}

/** 招待リンク経由で共有キャンバスのメンバーに加わる。 */
export async function joinSharedCanvas(id: string): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/join`, { method: "POST" });
  if (!res.ok) throw new Error(`共有キャンバスへの参加に失敗しました (status: ${res.status})`);
}

/** 自分をメンバーから外す（退出）。残りメンバーが0人になった場合は、その場で
 *  ルーム自体もサーバー側で削除される（バックエンド仕様、2026-08-24）。 */
export async function leaveSharedCanvas(id: string): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/leave`, { method: "POST" });
  if (!res.ok) throw new Error(`共有キャンバスからの退出に失敗しました (status: ${res.status})`);
}

/** ルームの名前を保存する（メンバー外は403、1〜100文字以外は400で失敗する）。
 *  保存後は既存のWebSocket通知（{type:"changed"}）経由で他のメンバーにも
 *  反映される（バックエンド仕様）。 */
export async function renameSharedCanvas(id: string, name: string): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`ルーム名の保存に失敗しました (status: ${res.status})`);
}

/** ルームの見た目(フレームの形・柄)を設定する。編集可能なメンバー(定員超過時の
 *  観覧者は対象外、issue #113④)以外は403で失敗する——名前変更と違い、メンバー
 *  全員の表示に強制的に反映されるための権限制限。保存後は既存のWebSocket通知
 *  （{type:"changed"}）経由で他のメンバーにも反映される。
 *  pairIndexは「メガネ1」(0、省略時の既定)/「メガネ2」(1、レンズ分割の2組目)
 *  のどちらを変更するかの指定(issue #113④)。 */
export async function updateSharedAppearance(
  id: string,
  frameShapeId: FrameShapeId,
  framePatternId: FramePatternId,
  pairIndex: 0 | 1 = 0
): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/appearance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frameShapeId, framePatternId, pairIndex }),
  });
  if (!res.ok) throw new Error(`見た目の保存に失敗しました (status: ${res.status})`);
}

function parseSession(data: unknown): SessionState | null {
  const session = (data as { session?: unknown }).session;
  if (!session || typeof session !== "object") return null;
  return session as SessionState;
}

function parseFrameShapeId(v: unknown): FrameShapeId | null {
  return typeof v === "string" && (FRAME_SHAPE_ORDER as string[]).includes(v) ? (v as FrameShapeId) : null;
}

function parseFramePatternId(v: unknown): FramePatternId | null {
  return typeof v === "string" && (FRAME_PATTERN_ORDER as string[]).includes(v) ? (v as FramePatternId) : null;
}

/** 指定した共有キャンバスの中身を取得する（メンバー外は403で失敗する）。 */
export async function getSharedCanvas(id: string): Promise<SharedCanvasDetail> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`共有キャンバスの取得に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const memos = (data as { memos?: unknown }).memos;
  const ownerId = (data as { ownerId?: unknown }).ownerId;
  return {
    id,
    ownerId: typeof ownerId === "string" ? ownerId : "",
    memos: Array.isArray(memos) ? (memos as Memo[]) : [],
    session: parseSession(data),
    frameShapeId: parseFrameShapeId((data as { frameShapeId?: unknown }).frameShapeId),
    framePatternId: parseFramePatternId((data as { framePatternId?: unknown }).framePatternId),
    frameShapeId2: parseFrameShapeId((data as { frameShapeId2?: unknown }).frameShapeId2),
    framePatternId2: parseFramePatternId((data as { framePatternId2?: unknown }).framePatternId2),
  };
}

/** メモ1件を保存する（作成・編集・移動のいずれも同じエンドポイント。メンバー外は403で失敗する）。
 *  X-Client-IdヘッダーはWebSocket経由で自分に跳ね返ってくる通知を無視するために
 *  サーバーがそのまま転送するだけの識別子（clientId.ts参照）。 */
export async function upsertSharedMemo(id: string, memo: Memo): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/memos/${encodeURIComponent(memo.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID },
    body: JSON.stringify({ memo }),
  });
  if (!res.ok) throw new Error(`メモの保存に失敗しました (status: ${res.status})`);
}

/** メモ1件を削除する（メンバー外は403で失敗する）。 */
export async function deleteSharedMemo(id: string, memoId: string): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/memos/${encodeURIComponent(memoId)}`, {
    method: "DELETE",
    headers: { "X-Client-Id": CLIENT_ID },
  });
  if (!res.ok) throw new Error(`メモの削除に失敗しました (status: ${res.status})`);
}

// --- 共同アイデア出しセッション（ルームマスターのみ開始・進行・延長・終了できる） ---

export interface StartSessionOptions {
  phase1Ms: number;
  phase2Ms: number;
  phase3Ms: number;
  maxParticipants: number;
}

/** セッションを開始する（ルームマスター以外は403、既にセッション中なら409で失敗する）。 */
export async function startSession(id: string, options: StartSessionOptions): Promise<SessionState | null> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error(`セッションの開始に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  return parseSession(data);
}

/** 次のフェーズへ進める。voting中に呼ぶと、確定処理をしてセッションを終了する。 */
export async function advanceSession(id: string): Promise<SessionState | null> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/session/advance`, { method: "POST" });
  if (!res.ok) throw new Error(`フェーズの進行に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  return parseSession(data);
}

/** 現在のフェーズの残り時間をaddMsぶん延長する。 */
export async function extendSession(id: string, addMs: number): Promise<SessionState | null> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/session/extend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addMs }),
  });
  if (!res.ok) throw new Error(`延長に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  return parseSession(data);
}

/** セッションを終了する。votingフェーズ中ならメモの濃さを確定させ「結果」フェーズへ
 *  ロックする(戻り値のphaseが"results"になる)。ideation/discussion中は何も確定させずに
 *  中断する(戻り値はnull)。既に"results"中に呼ぶと409で失敗する(resumeSessionを使う)。 */
export async function endSession(id: string): Promise<SessionState | null> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/session/end`, { method: "POST" });
  if (!res.ok) throw new Error(`セッションの終了に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  return parseSession(data);
}

/** 結果ロック("results"フェーズ)から明示的に編集を再開する。ルームマスターのみ。 */
export async function resumeSession(id: string): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/session/resume`, { method: "POST" });
  if (!res.ok) throw new Error(`編集の再開に失敗しました (status: ${res.status})`);
}

/** 投票フェーズ専用: メモを1回転させた時に呼ぶ。熱量+1後の値をサーバーから受け取る
 *  （楽観的にローカルへ反映済みの値をここで確定値に合わせ直す想定）。相対密度の
 *  計算は毎フレーム全メモから計算し直す(canvasView.ts)ため、サーバーが返す
 *  maxHeatは使わない——レスポンスにはheatだけを残す。 */
export async function addMemoHeat(id: string, memoId: string): Promise<{ heat: number }> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/memos/${encodeURIComponent(memoId)}/heat`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`熱量の加算に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const heat = (data as { heat?: unknown }).heat;
  return { heat: typeof heat === "number" ? heat : 0 };
}
