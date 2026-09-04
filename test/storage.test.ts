import { beforeEach, describe, expect, it } from "vitest";
import {
  appendExportEvent,
  listArchivedDateKeys,
  loadArchive,
  loadArchiveExportFlags,
  loadExportEvents,
  loadFirstResetHintShown,
  loadLastActiveDate,
  loadMemos,
  markArchiveExportFlag,
  markFirstResetHintShown,
  saveArchive,
  saveLastActiveDate,
  saveMemos,
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

describe("storage migration（道具・色を持たない古い形式のデータ）", () => {
  it("tool/colorが無いデータに既定値を補って読み込む", () => {
    const legacy = {
      id: "memo_legacy",
      x: 0,
      y: 0,
      strokes: [[{ x: 0, y: 0 }]],
      createdAt: 1000,
      status: "active",
      // tool, color は無い（古い保存形式）
    };
    localStorage.setItem("memos", JSON.stringify([legacy]));

    const loaded = loadMemos();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].tool).toBe("pen");
    expect(loaded[0].color).toBe("oklch(22% 0.012 55)");
  });

  it("経時フェード機能があった旧バージョンのlastTracedAt/traceHistory/lifespanDaysが付いたデータも、それらを無視して読み込める", () => {
    const legacy = {
      id: "memo_legacy2",
      x: 0,
      y: 0,
      strokes: [],
      createdAt: 1000,
      lastTracedAt: 5000,
      traceHistory: [1000, 5000],
      lifespanDays: 3,
      status: "active",
    };
    localStorage.setItem("memos", JSON.stringify([legacy]));

    const loaded = loadMemos();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].createdAt).toBe(1000);
  });

  it("形が壊れているデータは読み飛ばす", () => {
    localStorage.setItem("memos", JSON.stringify([{ garbage: true }, null, "x"]));
    expect(loadMemos()).toEqual([]);
  });

  it("壊れたJSON文字列は例外を投げず空配列を返す", () => {
    localStorage.setItem("memos", "{not valid json");
    expect(loadMemos()).toEqual([]);
  });

  it("新しい形式のデータはそのまま往復する", () => {
    const memo: Memo = {
      id: "memo_1",
      kind: "stroke",
      x: 0.1,
      y: -0.2,
      strokes: [
        [
          { x: 0, y: 0 },
          { x: 0.1, y: 0.1 },
        ],
      ],
      createdAt: 100,
      status: "active",
      tool: "marker",
      color: "#ff0000",
    };
    saveMemos([memo]);
    expect(loadMemos()).toEqual([memo]);
  });

  it("テキストメモもそのまま往復する", () => {
    const memo: Memo = {
      id: "memo_text_1",
      kind: "text",
      x: 0.2,
      y: -0.1,
      text: "こんにちは\n世界",
      textLines: ["こんにちは", "世界"],
      fontSize: 24,
      boxWidth: 0.5,
      boxHeight: 0.2,
      createdAt: 100,
      status: "active",
      color: "#2f2a26",
      align: "center",
      lineHeight: 1.4,
    };
    saveMemos([memo]);
    expect(loadMemos()).toEqual([memo]);
  });

  it("lineWidthを持つ手描きメモは、読み込み後もlineWidthを保持する（移行漏れの回帰テスト）", () => {
    const memo: Memo = {
      id: "memo_linewidth",
      kind: "stroke",
      x: 0,
      y: 0,
      strokes: [[{ x: 0, y: 0 }]],
      createdAt: 100,
      status: "active",
      tool: "pen",
      color: "#000000",
      lineWidth: 4,
    };
    saveMemos([memo]);

    const loaded = loadMemos();
    expect(loaded[0].kind).toBe("stroke");
    if (loaded[0].kind === "stroke") {
      expect(loaded[0].lineWidth).toBe(4);
    }
  });

  it("kindが無い古いデータ(テキスト機能追加前)はstrokeメモとして移行される", () => {
    const legacy = {
      id: "memo_legacy3",
      x: 0,
      y: 0,
      strokes: [[{ x: 0, y: 0 }]],
      createdAt: 1000,
      status: "active",
    };
    localStorage.setItem("memos", JSON.stringify([legacy]));

    const loaded = loadMemos();
    expect(loaded[0].kind).toBe("stroke");
  });

  it("textLines/boxWidth/boxHeightを欠いたテキストデータには既定値を補う", () => {
    const legacy = {
      id: "memo_text_legacy",
      kind: "text",
      x: 0,
      y: 0,
      text: "hello",
      createdAt: 1000,
      status: "active",
    };
    localStorage.setItem("memos", JSON.stringify([legacy]));

    const loaded = loadMemos();
    expect(loaded).toHaveLength(1);
    const memo = loaded[0];
    expect(memo.kind).toBe("text");
    if (memo.kind === "text") {
      expect(memo.textLines).toEqual(["hello"]);
      expect(memo.fontSize).toBeGreaterThan(0);
      expect(memo.boxWidth).toBeGreaterThan(0);
      expect(memo.boxHeight).toBeGreaterThan(0);
    }
  });
});

describe("アーカイブ（朝リセットで退避したメモ、dailyReset.ts参照）", () => {
  const memo: Memo = {
    id: "memo_archived",
    kind: "stroke",
    x: 0,
    y: 0,
    strokes: [[{ x: 0, y: 0 }]],
    createdAt: 100,
    status: "active",
    tool: "pen",
    color: "#000000",
  };

  it("日付キーごとにmemosキーと同じ形式でそのまま往復する", () => {
    saveArchive("2026-09-01", [memo]);
    expect(loadArchive("2026-09-01")).toEqual([memo]);
  });

  it("localStorage上は暗号化されていないプレーンなJSON配列として保存される", () => {
    saveArchive("2026-09-01", [memo]);
    const raw = localStorage.getItem("archive:2026-09-01");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual([memo]);
  });

  it("日付キーが異なればそれぞれ独立して保持される", () => {
    saveArchive("2026-09-01", [memo]);
    saveArchive("2026-09-02", []);
    expect(loadArchive("2026-09-01")).toHaveLength(1);
    expect(loadArchive("2026-09-02")).toHaveLength(0);
  });

  it("存在しない日付キーは空配列を返す", () => {
    expect(loadArchive("2099-01-01")).toEqual([]);
  });

  it("壊れたJSON文字列は例外を投げず空配列を返す", () => {
    localStorage.setItem("archive:2026-09-01", "{not valid json");
    expect(loadArchive("2026-09-01")).toEqual([]);
  });
});

describe("listArchivedDateKeys（記録一覧画面、recordGrid.ts参照）", () => {
  const memo: Memo = {
    id: "memo_listed",
    kind: "stroke",
    x: 0,
    y: 0,
    strokes: [[{ x: 0, y: 0 }]],
    createdAt: 100,
    status: "active",
    tool: "pen",
    color: "#000000",
  };

  it("未記録の間は空配列を返す", () => {
    expect(listArchivedDateKeys()).toEqual([]);
  });

  it("保存済みの日付キーを全て返す", () => {
    saveArchive("2026-09-01", [memo]);
    saveArchive("2026-09-02", [memo]);
    expect(listArchivedDateKeys().sort()).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("archive:以外のキー（memos/lastActiveDate等）は含めない", () => {
    saveArchive("2026-09-01", [memo]);
    saveMemos([memo]);
    saveLastActiveDate("2026-09-03");
    expect(listArchivedDateKeys()).toEqual(["2026-09-01"]);
  });
});

describe("lastActiveDate（朝リセットの日付比較用、dailyReset.ts参照）", () => {
  it("未設定の間はnullを返す", () => {
    expect(loadLastActiveDate()).toBeNull();
  });

  it("保存した値がそのまま読める", () => {
    saveLastActiveDate("2026-09-03");
    expect(loadLastActiveDate()).toBe("2026-09-03");
  });
});

describe("firstResetHintShown（初回の朝リセット時だけ出す一言ヒント、E2-14）", () => {
  it("未設定の間はfalseを返す", () => {
    expect(loadFirstResetHintShown()).toBe(false);
  });

  it("markFirstResetHintShown後はtrueを返す", () => {
    markFirstResetHintShown();
    expect(loadFirstResetHintShown()).toBe(true);
  });
});

describe("エクスポートイベントログ（E8-06、コアループの利用実態計測）", () => {
  it("未記録の間は空配列を返す", () => {
    expect(loadExportEvents()).toEqual([]);
  });

  it("appendExportEventで追記した内容がそのまま往復する", () => {
    appendExportEvent({ timestamp: 1000, kind: "image" });
    appendExportEvent({ timestamp: 2000, kind: "text" });
    expect(loadExportEvents()).toEqual([
      { timestamp: 1000, kind: "image" },
      { timestamp: 2000, kind: "text" },
    ]);
  });

  it("localStorage上は暗号化されていないプレーンなJSON配列として保存される", () => {
    appendExportEvent({ timestamp: 1000, kind: "image" });
    const raw = localStorage.getItem("exportEvents");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual([{ timestamp: 1000, kind: "image" }]);
  });

  it("壊れたJSON文字列は例外を投げず空配列を返す", () => {
    localStorage.setItem("exportEvents", "{not valid json");
    expect(loadExportEvents()).toEqual([]);
  });
});

describe("archiveExportFlags（E8-06、日付ごとの持ち出しフラグ）", () => {
  it("未記録の間は空オブジェクトを返す", () => {
    expect(loadArchiveExportFlags()).toEqual({});
  });

  it("日付キーごとにtrue/falseを記録できる", () => {
    markArchiveExportFlag("2026-09-01", true);
    markArchiveExportFlag("2026-09-02", false);
    expect(loadArchiveExportFlags()).toEqual({ "2026-09-01": true, "2026-09-02": false });
  });

  it("同じ日付キーへの再記録は上書きする", () => {
    markArchiveExportFlag("2026-09-01", false);
    markArchiveExportFlag("2026-09-01", true);
    expect(loadArchiveExportFlags()).toEqual({ "2026-09-01": true });
  });
});
