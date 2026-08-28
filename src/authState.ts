/**
 * 「今ログインしている人は誰か」を、Clerkの詳細を知らなくても他の機能から使えるようにする窓口。
 * コラボ機能側（誰が編集しているかを表示する等）はこれだけ読めば十分なはず。
 * ログインしていない、またはClerkの設定(.env.local)が無い場合はnullのまま。
 */

interface CurrentUser {
  id: string;
  name: string;
  imageUrl: string;
}

type Listener = (user: CurrentUser | null) => void;

let current: CurrentUser | null = null;
const listeners = new Set<Listener>();

/** 今ログインしている人のスナップショットを取る（ログインしていなければnull）。 */
export function getCurrentUser(): CurrentUser | null {
  return current;
}

/**
 * ログイン状態やプロフィールが変わるたびに呼ばれるリスナーを登録する。
 * 登録した時点の状態でも1回呼ばれる。戻り値を呼ぶと解除できる。
 */
export function onUserChange(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

/** clerkAccount.tsだけが呼ぶ内部用の更新関数。他の場所から直接呼ばないこと。 */
export function _setCurrentUser(user: CurrentUser | null): void {
  current = user;
  listeners.forEach((listener) => listener(current));
}
