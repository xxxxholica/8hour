import { beforeEach, describe, expect, it } from "vitest";
import {
  clearHistory,
  loadHistory,
  loadMemos,
  loadSheetStartedAt,
  loadThemePreference,
  saveHistory,
  saveMemos,
  saveSheetStartedAt,
  saveThemePreference,
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

describe("セキュリティ・入力検証（localStorage改ざん・破損耐性）", () => {
  it("NaNやInfinityを含む座標データは読み飛ばす", () => {
    localStorage.setItem(
      "memos",
      '[{"id":"m1","kind":"stroke","x":null,"y":0,"strokes":[[{"x":0,"y":0}]],"createdAt":100,"status":"active"}]'
    );
    expect(loadMemos()).toEqual([]);
  });

  it("strokesの内部要素がPoint配列でない不正データを読み飛ばす", () => {
    const malformed = [
      {
        id: "m_bad_strokes",
        kind: "stroke",
        x: 0,
        y: 0,
        strokes: [["not-a-point"], [{ x: "bad", y: 0 }]],
        createdAt: 100,
        status: "active",
      },
    ];
    localStorage.setItem("memos", JSON.stringify(malformed));
    expect(loadMemos()).toEqual([]);
  });

  it("不正なCSS色文字列やインジェクション文字列は既定のインク色にフォールバックする", () => {
    const tampered = [
      {
        id: "m_color_tamper",
        kind: "stroke",
        x: 0,
        y: 0,
        strokes: [[{ x: 0, y: 0 }]],
        createdAt: 100,
        status: "active",
        tool: "evil-tool",
        color: "red; background: url(https://evil.example/x)",
      },
    ];
    localStorage.setItem("memos", JSON.stringify(tampered));
    const loaded = loadMemos();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].tool).toBe("pen");
    expect(loaded[0].color).toBe("oklch(22% 0.012 55)");
  });
});

describe("sheetStartedAt（8時間タイマー開始時刻）", () => {
  it("未設定の間はnullを返す", () => {
    expect(loadSheetStartedAt()).toBeNull();
  });

  it("正のタイムスタンプを保存・復元でき、nullでリセットできる", () => {
    saveSheetStartedAt(1700000000000);
    expect(loadSheetStartedAt()).toBe(1700000000000);
    saveSheetStartedAt(null);
    expect(loadSheetStartedAt()).toBeNull();
  });

  it("不正な文字列や0以下の値はnullを返す", () => {
    localStorage.setItem("sheetStartedAt", "not-a-number");
    expect(loadSheetStartedAt()).toBeNull();
    localStorage.setItem("sheetStartedAt", "-100");
    expect(loadSheetStartedAt()).toBeNull();
  });
});

describe("themePreference（テーマ設定の保存・復元）", () => {
  it("未設定または不正値の場合はsystemを返す", () => {
    expect(loadThemePreference()).toBe("system");
    localStorage.setItem("themePreference", "invalid");
    expect(loadThemePreference()).toBe("system");
  });

  it("light / dark / system を保存してそのまま読み込める", () => {
    saveThemePreference("dark");
    expect(loadThemePreference()).toBe("dark");
    saveThemePreference("light");
    expect(loadThemePreference()).toBe("light");
    saveThemePreference("system");
    expect(loadThemePreference()).toBe("system");
  });
});

describe("テキストの配置方式（layout）", () => {
  const baseText = {
    kind: "text",
    x: 0,
    y: 0,
    text: "a",
    textLines: ["a"],
    fontSize: 24,
    boxWidth: 0.2,
    boxHeight: 0.1,
    createdAt: 1,
    status: "active",
    color: "#000",
  };

  it("layout: \"line\" のテキストメモはそのまま往復する", () => {
    localStorage.setItem("memos", JSON.stringify([{ ...baseText, id: "t1", align: "left", layout: "line" }]));
    const loaded = loadMemos()[0];
    expect(loaded.kind === "text" && loaded.layout).toBe("line");
  });

  it("layoutを持たない既存データ・不正値はフリー扱い（layoutを付けない）", () => {
    localStorage.setItem(
      "memos",
      JSON.stringify([
        { ...baseText, id: "t2" },
        { ...baseText, id: "t3", layout: "bogus" },
      ])
    );
    for (const memo of loadMemos()) {
      expect(memo.kind === "text" && memo.layout).toBeUndefined();
    }
  });
});

describe("undo/redo履歴の保存・復元", () => {
  const stroke = (id: string, points = 3): Memo => ({
    id,
    kind: "stroke",
    x: 0,
    y: 0,
    strokes: [Array.from({ length: points }, (_, i) => ({ x: i / 10, y: i / 20 }))],
    tool: "pen",
    color: "#000",
    createdAt: 1,
    status: "active",
  });
  const textMemo = (id: string, text: string): Memo => ({
    id,
    kind: "text",
    x: 0,
    y: 0,
    text,
    textLines: [text],
    fontSize: 24,
    boxWidth: 0.4,
    boxHeight: 0.1,
    createdAt: 1,
    status: "active",
    color: "#000",
    align: "left",
    lineHeight: 1.4,
    layout: "line",
  });

  it("保存した履歴をそのまま復元できる（undo・redoともに、コマの順番を保つ）", () => {
    const undo = [[], [stroke("a")], [stroke("a"), textMemo("t", "こんにちは")]];
    const redo = [[stroke("a"), textMemo("t", "こんにちは"), stroke("b")]];
    saveHistory(undo, redo);
    const loaded = loadHistory();
    expect(loaded.undo).toEqual(undo);
    expect(loaded.redo).toEqual(redo);
  });

  it("復元したコマ同士・メモ同士はオブジェクトを共有しない（片方を書き換えても他に影響しない）", () => {
    const shared = stroke("a");
    saveHistory([[shared], [shared]], []);
    const loaded = loadHistory();
    expect(loaded.undo[0][0]).not.toBe(loaded.undo[1][0]);
    (loaded.undo[0][0] as { x: number }).x = 99;
    expect(loaded.undo[1][0].x).toBe(0);
  });

  it("同じ内容のメモは1つだけ保存する（コマ数が増えても、保存サイズは「全体＋変わった分」程度）", () => {
    const base = Array.from({ length: 20 }, (_, i) => stroke(`m${i}`, 200));
    const one = JSON.stringify(base).length;
    // 隣り合うコマで1つのメモだけが違う、50コマの履歴
    const undo = Array.from({ length: 50 }, (_, k) => base.map((m, i) => (i === 0 ? stroke("m0", 200 + k) : m)));
    saveHistory(undo, []);
    const saved = localStorage.getItem("memoHistory")!;
    expect(saved.length).toBeLessThan(one * 6); // 素朴に全コマを保存すると約50倍
    expect(loadHistory().undo).toHaveLength(50);
  });

  it("容量の上限を超えるときは、古いundoのコマから減らして収める", () => {
    const big = (n: number) => [stroke(`b${n}`, 60000)]; // 1コマ約2MB（コマごとに別内容）
    const undo = [big(0), big(1), big(2), big(3)];
    saveHistory(undo, []);
    const loaded = loadHistory();
    expect(loaded.undo.length).toBeGreaterThan(0);
    expect(loaded.undo.length).toBeLessThan(4);
    // 残るのは新しい側のコマ
    expect(loaded.undo[loaded.undo.length - 1][0].id).toBe("b3");
  });

  it("保存が無い・壊れている・形式が違うときは、空の履歴を返す", () => {
    expect(loadHistory()).toEqual({ undo: [], redo: [] });
    localStorage.setItem("memoHistory", "{broken");
    expect(loadHistory()).toEqual({ undo: [], redo: [] });
    localStorage.setItem("memoHistory", JSON.stringify({ v: 999, pool: [], undo: [], redo: [] }));
    expect(loadHistory()).toEqual({ undo: [], redo: [] });
    localStorage.setItem("memoHistory", JSON.stringify({ v: 1, pool: ["{\"id\":1}"], undo: [[0]], redo: [] }));
    expect(loadHistory()).toEqual({ undo: [], redo: [] });
    localStorage.setItem("memoHistory", JSON.stringify({ v: 1, pool: [], undo: [[5]], redo: [] }));
    expect(loadHistory()).toEqual({ undo: [], redo: [] });
    // 改ざんによる過剰な参照増幅（DoS）も拒否して空を返す
    localStorage.setItem(
      "memoHistory",
      JSON.stringify({
        v: 1,
        pool: [JSON.stringify(stroke("a"))],
        undo: [Array.from({ length: 20000 }, () => 0)],
        redo: [],
      })
    );
    expect(loadHistory()).toEqual({ undo: [], redo: [] });
  });

  it("clearHistoryで保存済みの履歴を消せる", () => {
    saveHistory([[stroke("a")]], []);
    clearHistory();
    expect(loadHistory()).toEqual({ undo: [], redo: [] });
  });
});

