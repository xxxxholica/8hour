import { beforeEach, describe, expect, it } from "vitest";
import { loadMemos, saveMemos } from "../src/storage";
import { LINE_HEIGHT_MULTIPLIER } from "../src/textLayout";
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

describe("storage migration（道具・色・なぞり履歴を持たない古い形式のデータ）", () => {
  it("tool/color/traceHistoryが無いデータに既定値を補って読み込む", () => {
    const legacy = {
      id: "memo_legacy",
      x: 0,
      y: 0,
      strokes: [[{ x: 0, y: 0 }]],
      createdAt: 1000,
      lastTracedAt: 1000,
      lifespanDays: null,
      status: "active",
      // tool, color, traceHistory は無い（古い保存形式）
    };
    localStorage.setItem("memos", JSON.stringify([legacy]));

    const loaded = loadMemos();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].tool).toBe("pen");
    expect(loaded[0].color).toBe("oklch(22% 0.012 55)");
    expect(loaded[0].traceHistory).toEqual([1000]);
  });

  it("lastTracedAtがcreatedAtと異なる古いデータは、traceHistoryを2点で推測復元する", () => {
    const legacy = {
      id: "memo_legacy2",
      x: 0,
      y: 0,
      strokes: [],
      createdAt: 1000,
      lastTracedAt: 5000,
      lifespanDays: 3,
      status: "active",
    };
    localStorage.setItem("memos", JSON.stringify([legacy]));

    const loaded = loadMemos();
    expect(loaded[0].traceHistory).toEqual([1000, 5000]);
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
      strokes: [[{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }]],
      createdAt: 100,
      lastTracedAt: 200,
      traceHistory: [100, 200],
      lifespanDays: 7,
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
      lastTracedAt: 100,
      traceHistory: [100],
      lifespanDays: null,
      status: "active",
      color: "#2f2a26",
      align: "center",
      lineHeight: LINE_HEIGHT_MULTIPLIER,
    };
    saveMemos([memo]);
    expect(loadMemos()).toEqual([memo]);
  });

  it("kindが無い古いデータ(テキスト機能追加前)はstrokeメモとして移行される", () => {
    const legacy = {
      id: "memo_legacy3",
      x: 0,
      y: 0,
      strokes: [[{ x: 0, y: 0 }]],
      createdAt: 1000,
      lastTracedAt: 1000,
      lifespanDays: null,
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
      lastTracedAt: 1000,
      lifespanDays: null,
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
