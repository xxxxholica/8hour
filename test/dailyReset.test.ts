import { beforeEach, describe, expect, it } from "vitest";
import { dateKeyFor, daysBetween, performDailyResetIfNeeded, shiftDateKey } from "../src/dailyReset";
import {
  loadArchive,
  loadArchiveExportFlags,
  loadLastActiveDate,
  loadMemos,
  saveLastActiveDate,
  saveMemos,
  appendExportEvent,
} from "../src/storage";
import type { Memo } from "../src/types";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
});

function makeMemo(id: string): Memo {
  return {
    id,
    kind: "stroke",
    x: 0,
    y: 0,
    strokes: [[{ x: 0, y: 0 }]],
    createdAt: 100,
    status: "active",
    tool: "pen",
    color: "#000000",
  };
}

describe("dateKeyFor", () => {
  it("ローカルタイムゾーンでのYYYY-MM-DDを返す", () => {
    expect(dateKeyFor(new Date(2026, 8, 3, 23, 59))).toBe("2026-09-03");
    expect(dateKeyFor(new Date(2026, 0, 5, 0, 0))).toBe("2026-01-05");
  });
});

describe("shiftDateKey（過去めくり画面の「前の日」「次の日」ナビゲーション用）", () => {
  it("通常の1日前・1日後", () => {
    expect(shiftDateKey("2026-09-03", -1)).toBe("2026-09-02");
    expect(shiftDateKey("2026-09-03", 1)).toBe("2026-09-04");
  });

  it("月をまたぐ", () => {
    expect(shiftDateKey("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDateKey("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("年をまたぐ", () => {
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDateKey("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("複数日ぶんまとめてずらす", () => {
    expect(shiftDateKey("2026-09-03", -3)).toBe("2026-08-31");
  });
});

describe("daysBetween（過去めくり画面のURL状態復元、?view=past&date=...用）", () => {
  it("toKeyの方が未来なら正の日数を返す", () => {
    expect(daysBetween("2026-09-01", "2026-09-03")).toBe(2);
  });

  it("toKeyの方が過去なら負の日数を返す", () => {
    expect(daysBetween("2026-09-03", "2026-09-01")).toBe(-2);
  });

  it("同じ日なら0", () => {
    expect(daysBetween("2026-09-03", "2026-09-03")).toBe(0);
  });

  it("月をまたぐ", () => {
    expect(daysBetween("2026-08-31", "2026-09-02")).toBe(2);
  });

  it("年をまたぐ", () => {
    expect(daysBetween("2025-12-30", "2026-01-02")).toBe(3);
  });

  it("shiftDateKeyの逆演算になっている（fromKeyをdeltaDaysずらすとtoKeyに一致する）", () => {
    const delta = daysBetween("2026-09-01", "2026-09-05");
    expect(shiftDateKey("2026-09-01", delta)).toBe("2026-09-05");
  });
});

describe("performDailyResetIfNeeded", () => {
  it("lastActiveDateが未設定（この機能を初めて読み込む既存ユーザー）の場合は、既存memosをアーカイブせず当日の日付を記録するだけ", () => {
    saveMemos([makeMemo("memo_existing")]);

    const changed = performDailyResetIfNeeded(new Date(2026, 8, 3));

    expect(changed).toBe(false);
    expect(loadMemos()).toHaveLength(1);
    expect(loadLastActiveDate()).toBe("2026-09-03");
  });

  it("同日中の呼び出しは冪等（何もしない）", () => {
    saveLastActiveDate("2026-09-03");
    saveMemos([makeMemo("memo_today")]);

    const changed = performDailyResetIfNeeded(new Date(2026, 8, 3, 18, 0));

    expect(changed).toBe(false);
    expect(loadMemos()).toHaveLength(1);
  });

  it("日付が変わっていれば、前日のmemosをアーカイブへ退避してmemosを空にする", () => {
    saveLastActiveDate("2026-09-02");
    saveMemos([makeMemo("memo_yesterday")]);

    const changed = performDailyResetIfNeeded(new Date(2026, 8, 3, 7, 0));

    expect(changed).toBe(true);
    expect(loadMemos()).toEqual([]);
    expect(loadArchive("2026-09-02")).toEqual([makeMemo("memo_yesterday")]);
    expect(loadLastActiveDate()).toBe("2026-09-03");
  });

  it("空のキャンバスのまま日付が変わった場合は、空のアーカイブキーを作らない", () => {
    saveLastActiveDate("2026-09-02");
    saveMemos([]);

    performDailyResetIfNeeded(new Date(2026, 8, 3));

    expect(localStorage.getItem("archive:2026-09-02")).toBeNull();
  });

  it("複数日をまたいで放置されていた場合も、直近のmemosだけを前回の日付キーでアーカイブする", () => {
    saveLastActiveDate("2026-08-30");
    saveMemos([makeMemo("memo_old")]);

    performDailyResetIfNeeded(new Date(2026, 8, 3));

    expect(loadArchive("2026-08-30")).toHaveLength(1);
    expect(loadLastActiveDate()).toBe("2026-09-03");
  });
});

describe("performDailyResetIfNeeded（E8-06：持ち出しフラグの記録）", () => {
  it("アーカイブ対象日のうちにエクスポートがあれば、その日付キーにtrueを記録する", () => {
    saveLastActiveDate("2026-09-02");
    saveMemos([makeMemo("memo_yesterday")]);
    // 2026-09-02の日中（ローカル時刻）にエクスポートしたイベント
    appendExportEvent({ timestamp: new Date(2026, 8, 2, 15, 0).getTime(), kind: "text" });

    performDailyResetIfNeeded(new Date(2026, 8, 3, 7, 0));

    expect(loadArchiveExportFlags()).toEqual({ "2026-09-02": true });
  });

  it("アーカイブ対象日のうちにエクスポートが無ければ、その日付キーにfalseを記録する", () => {
    saveLastActiveDate("2026-09-02");
    saveMemos([makeMemo("memo_yesterday")]);
    // 別の日（2026-09-01）のエクスポートは対象日にカウントしない
    appendExportEvent({ timestamp: new Date(2026, 8, 1, 15, 0).getTime(), kind: "text" });

    performDailyResetIfNeeded(new Date(2026, 8, 3, 7, 0));

    expect(loadArchiveExportFlags()).toEqual({ "2026-09-02": false });
  });

  it("日付境界はローカル暦日基準（UTCではない）：日付が変わる直前・直後のタイムスタンプを正しく区別する", () => {
    saveLastActiveDate("2026-09-02");
    saveMemos([makeMemo("memo_yesterday")]);
    // 2026-09-02の23:59（ローカル）はその日のうちのエクスポートとして数える
    appendExportEvent({ timestamp: new Date(2026, 8, 2, 23, 59).getTime(), kind: "image" });
    // 2026-09-03の00:01（ローカル）は既に翌日なので数えない
    appendExportEvent({ timestamp: new Date(2026, 8, 3, 0, 1).getTime(), kind: "image" });

    performDailyResetIfNeeded(new Date(2026, 8, 3, 7, 0));

    expect(loadArchiveExportFlags()).toEqual({ "2026-09-02": true });
  });

  it("空のキャンバスのまま日付が変わった（アーカイブを作らない）日は、持ち出しフラグも記録しない", () => {
    saveLastActiveDate("2026-09-02");
    saveMemos([]);
    appendExportEvent({ timestamp: new Date(2026, 8, 2, 15, 0).getTime(), kind: "text" });

    performDailyResetIfNeeded(new Date(2026, 8, 3));

    expect(loadArchiveExportFlags()).toEqual({});
  });
});
