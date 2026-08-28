import { Clerk } from "@clerk/clerk-js";
import { _setCurrentUser } from "./authState";

/**
 * アカウント機能（ログイン・新規登録・ログアウト・現在のユーザー表示）はClerkに任せる。
 * 自前のAPI(api.onunu.me)は使わない——ClerkがユーザーDB・セッション・ログインUIを丸ごと提供するため。
 * ログインはこのアプリを使うための必須条件ではない（未ログインでも通常通りメモは使える）。
 */

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
let clerkForSignIn: Clerk | null = null;
let signInRequestedWhileLoading = false;

/** ヘッダー以外の未ログイン案内からも、同じClerkログイン画面を開く。Clerkの
 * 読み込み中に押された場合は、準備できた直後に一度だけ開く。 */
export function requestSignIn(): void {
  if (clerkForSignIn) {
    void clerkForSignIn.openSignIn({});
    return;
  }
  signInRequestedWhileLoading = true;
}

declare global {
  interface Window {
    __internal_ClerkUICtor?: unknown;
  }
}

/**
 * openSignIn/mountUserButton等のUI部分は@clerk/clerk-js本体に同梱されておらず、
 * publishable keyに埋め込まれたFrontend APIドメインから別バンドル(@clerk/ui)として
 * 読み込む必要がある。これをclerk.load()より先に済ませないと
 * 「Clerk was not loaded with Ui components」というエラーになる。
 */
async function loadClerkUiBundle(publishableKey: string): Promise<void> {
  const domainPart = publishableKey.split("_")[2];
  if (!domainPart) {
    throw new Error("publishable keyの形式が不正です（pk_test_... の形になっているか確認してください）");
  }
  const clerkDomain = atob(domainPart).slice(0, -1);

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("@clerk/ui バンドルの読み込みに失敗しました"));
    document.head.appendChild(script);
  });
}

/** ログイン中のみ有効な、セッショントークンを取得できるハンドル。クラウド同期(cloudSync.ts)に渡す。 */
export interface AuthSession {
  getToken: () => Promise<string | null>;
}

export async function mountAccountWidget(
  container: HTMLElement,
  onAuthChange?: (session: AuthSession | null) => void
): Promise<void> {
  if (!PUBLISHABLE_KEY) {
    const notice = document.createElement("span");
    notice.className = "account-badge account-badge-warning";
    notice.textContent = "アカウント機能: .env.local に VITE_CLERK_PUBLISHABLE_KEY が未設定です";
    container.appendChild(notice);
    return;
  }

  // Clerk本体（@clerk/ui含む）の読み込みには時間がかかるため、それを待たずに
  // 読み込み中を表す文言だけ先に表示しておく（ユーザー指摘：後からポップイン
  // して見えるのが気になる）。クリックはまだClerkの準備前なので受け付けず、
  // 読み込み完了後にsync()が実際のボタンへ差し替える。
  const badge = document.createElement("div");
  badge.className = "account-badge";
  badge.innerHTML = '<button type="button" class="pill-btn account-text-btn" disabled>アカウント</button>';
  container.appendChild(badge);

  await loadClerkUiBundle(PUBLISHABLE_KEY);

  const clerk = new Clerk(PUBLISHABLE_KEY);
  await clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    appearance: {
      variables: {
        colorPrimary: "oklch(22% 0.012 55)",
        fontFamily: '"Noto Sans JP", sans-serif',
      },
    },
  } as Parameters<typeof clerk.load>[0]);
  clerkForSignIn = clerk;
  if (signInRequestedWhileLoading) {
    signInRequestedWhileLoading = false;
    void clerk.openSignIn({});
  }

  // アイコンのみのボタンだと未ログイン/ログイン中の状態が伝わりにくかった
  // （ユーザー指示：文字だけのボタンにしたい）ため、ClerkのUserButton
  // ウィジェットは使わず、状態に応じた文言のテキストボタンから直接
  // openSignIn/openUserProfileを呼ぶ。
  function renderSignedOut(): void {
    badge.innerHTML = "";
    const signInBtn = document.createElement("button");
    signInBtn.type = "button";
    signInBtn.className = "pill-btn account-text-btn";
    signInBtn.textContent = "ログイン / 新規登録";
    signInBtn.addEventListener("click", requestSignIn);
    badge.appendChild(signInBtn);
  }

  function renderSignedIn(): void {
    badge.innerHTML = "";
    const profileBtn = document.createElement("button");
    profileBtn.type = "button";
    profileBtn.className = "pill-btn account-text-btn";
    profileBtn.textContent = "アカウント情報";
    profileBtn.addEventListener("click", () => {
      void clerk.openUserProfile({});
    });
    badge.appendChild(profileBtn);

    // ログイン中だけ「アカウント情報」の下にログアウトボタンを出す
    // （ユーザー指示：ログアウト手段がなかった。未ログイン時は不要）。
    const signOutBtn = document.createElement("button");
    signOutBtn.type = "button";
    signOutBtn.className = "pill-btn account-text-btn";
    signOutBtn.textContent = "ログアウト";
    signOutBtn.addEventListener("click", () => {
      void clerk.signOut();
    });
    badge.appendChild(signOutBtn);
  }

  let wasSignedIn = false;

  function sync(): void {
    const isSignedIn = Boolean(clerk.user);
    if (isSignedIn) {
      renderSignedIn();
    } else {
      renderSignedOut();
    }

    // onAuthChangeを先に呼び、setTokenGetter経由でapiClient.tsのトークン取得関数を
    // 用意してから_setCurrentUserで他モジュールに通知する。逆順だと、_setCurrentUser
    // が同期的に呼ぶリスナー（SharedRoomMenuの招待リンク自動参加など）がその場で
    // authFetchを呼んだ時、まだtokenGetterが設定されておらず「未ログインです」で
    // 失敗する——ログイン済みで開いた招待リンクの自動参加が効かない不具合の原因だった。
    if (isSignedIn !== wasSignedIn) {
      wasSignedIn = isSignedIn;
      onAuthChange?.(
        isSignedIn
          ? {
              getToken: async () => {
                const token = await clerk.session?.getToken();
                return token ?? null;
              },
            }
          : null
      );
    }

    // コラボ機能などの他モジュールが、Clerkの詳細を知らずに「今のユーザー」を読めるようにする。
    _setCurrentUser(
      clerk.user
        ? {
            id: clerk.user.id,
            name: clerk.user.fullName ?? clerk.user.username ?? "名前未設定",
            imageUrl: clerk.user.imageUrl,
          }
        : null
    );
  }

  clerk.addListener(() => sync());
  sync();
}
