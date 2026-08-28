/**
 * このタブ(実行コンテキスト)を識別するランダムなID。共有キャンバスの同期
 * (sharedCanvas.ts・realtimeSync.ts)で、「自分が送った変更が自分のWebSocket
 * 通知として跳ね返ってきたもの」を無視するために使う——サーバー側は中身を
 * 見ずそのまま素通しするだけ(ichimaien-api/index.js参照)。ページを開くたびに
 * 新しく生成し、永続化はしない(issue #99)。
 */
function generateClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // crypto.randomUUID()はセキュアコンテキスト（HTTPS、またはlocalhost）でしか
  // 使えない仕様のため、スマホ実機での動作確認等でLAN内のIPアドレスへ
  // http://でアクセスすると未定義になり、モジュール読み込み時点で例外が
  // 発生してアプリ全体の初期化が止まってしまっていた（真っ白な画面になる、
  // ユーザー報告・実機で再現確認）。この値は自分のWebSocket通知を見分けられ
  // れば十分で暗号学的な強度は不要なため、使えない場合は代わりに時刻と
  // 乱数を組み合わせたフォールバック値を使う。
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export const CLIENT_ID: string = generateClientId();
