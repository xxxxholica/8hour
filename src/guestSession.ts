/**
 * 招待リンク経由のゲスト参加(issue #79)のセッション永続化。
 * Clerkアカウントを持たないため、参加時に払い出されるゲストセッション
 * トークンをlocalStorageに保存し、リロード後もそのルームへ再接続できる
 * ようにする(canvasIdごとに1つ)。
 */

import { API_BASE } from "./apiClient";

export interface StoredGuestSession {
  canvasId: string;
  token: string;
  expiresAt: number;
}

const KEY_PREFIX = "guestSession:";

export function loadGuestSession(canvasId: string): StoredGuestSession | null {
  const raw = localStorage.getItem(KEY_PREFIX + canvasId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredGuestSession;
    if (typeof parsed.token !== "string" || parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(KEY_PREFIX + canvasId);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(KEY_PREFIX + canvasId);
    return null;
  }
}

export function saveGuestSession(session: StoredGuestSession): void {
  localStorage.setItem(KEY_PREFIX + session.canvasId, JSON.stringify(session));
}

export function clearGuestSession(canvasId: string): void {
  localStorage.removeItem(KEY_PREFIX + canvasId);
}

/** 招待トークンをclaimしてゲストとして参加する。認証が確立する前の呼び出し
 *  なのでauthFetchは使わず、生のfetchで直接叩く。表示名の入力は求めない
 *  (以前はissue #128のリアクション実名表示のために必須だったが、その機能自体が
 *  revertされてどこにも表示されなくなっていたため、収集自体をやめた)。 */
export async function claimGuestInvite(canvasId: string, inviteToken: string): Promise<StoredGuestSession> {
  const res = await fetch(`${API_BASE}/shared-canvases/${encodeURIComponent(canvasId)}/guest-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inviteToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `ゲストとしての参加に失敗しました (status: ${res.status})`);
  }
  const data = await res.json();
  return { canvasId, token: data.token, expiresAt: data.expiresAt };
}
