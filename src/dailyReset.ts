import {
  loadExportEvents,
  loadLastActiveDate,
  loadMemos,
  markArchiveExportFlag,
  saveArchive,
  saveLastActiveDate,
  saveMemos,
} from "./storage";

/** 端末のローカルタイムゾーンでの暦日を"YYYY-MM-DD"にする（UTCではない。
 *  深夜0時をまたいだら別日、という素朴な判定にするため）。 */
export function dateKeyFor(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** dateKeyからdeltaDays日後（負数で前）の日付キーを返す。時刻成分は無視し、
 *  暦日の加減算だけを行う（月末・年末をまたぐ繰り上がり・DST等はDateの
 *  ローカル演算に委ねる）。過去めくり画面（archiveCanvas.ts/main.ts）の
 *  「前の日」「次の日」ナビゲーションに使う。 */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return dateKeyFor(new Date(y, m - 1, d + deltaDays));
}

/** fromKeyからtoKeyまでの暦日数の差（toKeyの方が未来なら正、過去なら負）。
 *  過去めくり画面のURL状態（?view=past&date=...、main.ts）を復元する際、
 *  URLの日付が「今日から何日前か」というhistoryOffsetに変換するために使う
 *  ——shiftDateKeyと同じくローカルのDate演算に委ねる（時刻成分は無視）。 */
export function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd).getTime();
  const to = new Date(ty, tm - 1, td).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/**
 * 朝リセット：前回記録した日付（lastActiveDate）と当日の日付を比較し、変わって
 * いれば当日のキャンバス（memos）を丸ごとアーカイブへ退避してから白紙にする。
 * 呼び出し側（main.ts）が、起動時・フォアグラウンド復帰時に呼ぶ責任を持つ。
 *
 * - 同日中の複数回呼び出しは冪等（2回目以降は何もしない）
 * - lastActiveDateが未記録（この機能を初めて読み込む既存ユーザー）の場合は、
 *   アーカイブせず・当日メモも消さず、単に当日の日付を記録するだけにする
 *   ——既存のmemosを「昨日のデータ」と誤認してアーカイブに移してしまわないため
 * - アーカイブ対象が0件（空のキャンバスのまま日付が変わった）の場合は、
 *   空配列のアーカイブキーを作らずスキップする（lastActiveDateの更新は行う）。
 *   E8-06の持ち出しフラグ（下記）も、これと完全に対で同じ条件でのみ記録
 *   する——揃えないと「何も書かなかった日」と「書いたが持ち出さなかった日」
 *   が区別できなくなるため
 * - 自動削除ロジックは持たない。アーカイブは無期限保持される
 *
 * コアループの利用実態の計測（E8-06）：アーカイブを作る（＝その日に何か
 * 書かれていた）場合にだけ、その日のうちに一度でもエクスポートが使われて
 * いたかをarchiveExportFlagsに記録する（storage.ts参照）。判定はエクスポート
 * イベントのtimestampをdateKeyFor()でローカル暦日に変換して比較する——UTCの
 * 日付境界ではなく、朝リセット自体と同じローカルタイムゾーン基準で揃える。
 *
 * 戻り値はリセットが実際に発生したか（呼び出し側が、既存のMemoStoreインスタンス
 * を持っている場合にreplaceAll([])で同期すべきかの判定に使う）。
 */
export function performDailyResetIfNeeded(now: Date = new Date()): boolean {
  const todayKey = dateKeyFor(now);
  const lastActiveKey = loadLastActiveDate();

  if (lastActiveKey === todayKey) return false;

  if (lastActiveKey !== null) {
    const memos = loadMemos();
    if (memos.length > 0) {
      saveArchive(lastActiveKey, memos);
      const exportedThatDay = loadExportEvents().some(
        (event) => dateKeyFor(new Date(event.timestamp)) === lastActiveKey
      );
      markArchiveExportFlag(lastActiveKey, exportedThatDay);
    }
    saveMemos([]);
  }
  saveLastActiveDate(todayKey);
  return lastActiveKey !== null;
}
