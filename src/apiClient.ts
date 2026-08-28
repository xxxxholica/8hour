/**
 * サーバー(api.onunu.me)向けの認証付きfetchの共通実装。
 * ログイン状態やトークンの取得方法は clerkAccount.ts からの通知を受けて
 * cloudSync.setTokenGetter が差し替える。cloudSync.ts（個人キャンバス）・
 * sharedCanvas.ts（コラボ機能）の両方がここを経由する。
 *
 * 招待リンク経由のゲスト参加(issue #79)はClerkアカウントを持たないため、
 * tokenGetterとは独立したguestAuthを持つ——Clerkでログイン中はtokenGetter
 * を優先し、無い場合だけguestAuthにフォールバックする(両方成立することは
 * 無い想定: ゲストはClerkにサインインしない)。
 */

export const API_BASE = "https://api.onunu.me";

export type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

/** cloudSync.setTokenGetter からだけ呼ばれる内部用の更新関数。 */
export function _setApiTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}

export function isSignedIn(): boolean {
  return tokenGetter !== null;
}

export interface GuestAuth {
  canvasId: string;
  token: string;
}

let guestAuth: GuestAuth | null = null;

/** guestSession.ts からだけ呼ばれる内部用の更新関数。 */
export function setGuestAuth(auth: GuestAuth | null): void {
  guestAuth = auth;
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (tokenGetter) {
    const token = await tokenGetter();
    if (!token) throw new Error("セッションが取得できませんでした");
    headers.set("Authorization", `Bearer ${token}`);
  } else if (guestAuth) {
    headers.set("Authorization", `Bearer ${guestAuth.token}`);
  } else {
    throw new Error("未ログインです");
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}
