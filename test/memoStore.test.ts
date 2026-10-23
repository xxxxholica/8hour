import { beforeEach, describe, expect, it } from "vitest";
import { clampToRect, isInsideClamp } from "../src/geometry";
import { MemoStore } from "../src/memoStore";
import type { MemoStyle } from "../src/types";

const canvasClamp = (p: { x: number; y: number }) => clampToRect(p, 1, 1);

// jsdom を使わず、localStorage 相当の最小モックだけ用意する
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

const STANDARD: MemoStyle = { tool: "pen", color: "#2f2a26" };

describe("MemoStore", () => {
  it("作成したメモはlocalStorageから復元できる（リロード耐性）", () => {
    const store = new MemoStore();
    store.createMemo({ x: 1, y: 2 }, STANDARD, 1000);

    const reloaded = new MemoStore();
    expect(reloaded.getAll()).toHaveLength(1);
    expect(reloaded.getAll()[0].tool).toBe("pen");
    expect(reloaded.getAll()[0].color).toBe("#2f2a26");
  });

  it("resetAllで全メモが消え、以後の読み込みにも影響しない", () => {
    const store = new MemoStore();
    store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    store.createMemo({ x: 1, y: 1 }, STANDARD, 0);
    expect(store.getAll()).toHaveLength(2);

    store.resetAll();
    expect(store.getAll()).toHaveLength(0);

    const reloaded = new MemoStore();
    expect(reloaded.getAll()).toHaveLength(0);
  });

  describe("createTextMemo（テキストメモ）", () => {
    it("テキストメモを作成でき、リロード後も復元される", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo(
        { x: 0, y: 0 },
        "こんにちは",
        ["こんにちは"],
        24,
        0.5,
        0.1,
        { color: "#2f2a26" },
        1000
      );
      expect(memo.kind).toBe("text");

      const reloaded = new MemoStore();
      const loaded = reloaded.getAll()[0];
      expect(loaded.kind).toBe("text");
      if (loaded.kind === "text") {
        expect(loaded.text).toBe("こんにちは");
        expect(loaded.textLines).toEqual(["こんにちは"]);
        expect(loaded.fontSize).toBe(24);
        expect(loaded.boxWidth).toBe(0.5);
        expect(loaded.boxHeight).toBe(0.1);
      }
    });

    it("layoutを指定して作成でき、updateTextMemoにpositionを渡すと中心座標も更新される", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo(
        { x: 0.1, y: 0.1 },
        "a",
        ["a"],
        24,
        0.2,
        0.1,
        { color: "#000", align: "left", layout: "line" },
        0
      );
      expect(memo.layout).toBe("line");
      store.updateTextMemo(memo.id, "ab", ["ab"], 0.4, 0.1, { position: { x: 0.2, y: 0.15 } });
      const updated = new MemoStore().getAll()[0];
      expect(updated.x).toBe(0.2);
      expect(updated.y).toBe(0.15);
      expect(updated.kind === "text" && updated.boxWidth).toBe(0.4);
      expect(updated.kind === "text" && updated.layout).toBe("line");
    });

    it("updateTextMemoにpositionを渡さなければ中心座標は変わらない", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo({ x: 0.1, y: 0.2 }, "a", ["a"], 24, 0.2, 0.1, { color: "#000" }, 0);
      store.updateTextMemo(memo.id, "ab", ["ab"], 0.4, 0.1);
      const updated = store.getAll()[0];
      expect([updated.x, updated.y]).toEqual([0.1, 0.2]);
    });

    it("updateTextMemoにlayout/align/colorを渡すと、配置や色を更新できる", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo({ x: 0, y: 0 }, "a", ["a"], 24, 0.2, 0.1, { color: "#000" }, 0);
      store.updateTextMemo(memo.id, "a", ["a"], 0.2, 0.1, { layout: "line", align: "left", color: "#f00" });
      const updated = store.getAll()[0];
      expect(updated.kind === "text" && [updated.layout, updated.align, updated.color]).toEqual(["line", "left", "#f00"]);
    });

    it("eraseAtのskipLineTextを指定すると、行モードのテキストには触れず、旧バージョンのテキストは従来どおり消す", () => {
      const store = new MemoStore();
      const line = store.createTextMemo({ x: 0, y: 0 }, "a", ["a"], 24, 0.4, 0.1, { color: "#000", layout: "line" }, 0);
      const legacy = store.createTextMemo({ x: 0, y: 0.5 }, "b", ["b"], 24, 0.4, 0.1, { color: "#000" }, 0);
      const changed = store.eraseAt({ x: 0, y: 0 }, 0.05, undefined, true);
      expect(changed).toBe(false);
      expect(store.getAll().map((m) => m.id)).toEqual([line.id, legacy.id]);
      expect(store.eraseAt({ x: 0, y: 0.5 }, 0.05, undefined, true)).toBe(true);
      expect(store.getAll().map((m) => m.id)).toEqual([line.id]);
    });

    it("テキストメモにはstartStroke/addPointToLastStrokeが効かない（手描き専用の操作のため）", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo({ x: 0, y: 0 }, "note", ["note"], 24, 0.5, 0.1, { color: "#000" }, 0);
      store.startStroke(memo.id, { x: 1, y: 1 });
      store.addPointToLastStroke(memo.id, { x: 2, y: 2 });
      const reloaded = store.getAll()[0];
      expect(reloaded.kind).toBe("text");
      if (reloaded.kind === "text") {
        expect(reloaded.text).toBe("note");
      }
    });

    it("消しゴムがテキストのボックスに触れるとメモごと削除される（部分削除はしない）", () => {
      const store = new MemoStore();
      store.createTextMemo({ x: 0, y: 0 }, "note", ["note"], 24, 0.4, 0.1, { color: "#000" }, 0);
      expect(store.getActive()).toHaveLength(1);

      const changed = store.eraseAt({ x: 0.05, y: 0 }, 0.02);
      expect(changed).toBe(true);
      expect(store.getActive()).toHaveLength(0);
    });

    it("消しゴムがテキストのボックスから離れていれば消えない", () => {
      const store = new MemoStore();
      store.createTextMemo({ x: 0, y: 0 }, "note", ["note"], 24, 0.4, 0.1, { color: "#000" }, 0);
      const changed = store.eraseAt({ x: 5, y: 5 }, 0.1);
      expect(changed).toBe(false);
      expect(store.getActive()).toHaveLength(1);
    });
  });

  describe("translateMemo（移動道具でのドラッグ移動）", () => {
    it("手描きメモの全ストロークの点が同じだけ平行移動し、代表座標(x/y)も追従する", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.addPointToLastStroke(memo.id, { x: 0.2, y: 0 });

      store.translateMemo(memo.id, 0.1, 0.1);

      const updated = store.getActive()[0];
      expect(updated.kind).toBe("stroke");
      if (updated.kind === "stroke") {
        expect(updated.strokes[0][0].x).toBeCloseTo(0.1);
        expect(updated.strokes[0][0].y).toBeCloseTo(0.1);
        expect(updated.strokes[0][1].x).toBeCloseTo(0.3);
        expect(updated.strokes[0][1].y).toBeCloseTo(0.1);
      }
      expect(updated.x).toBeCloseTo(0.1);
      expect(updated.y).toBeCloseTo(0.1);
    });

    it("テキストメモは代表座標(x/y)がそのまま平行移動する", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo({ x: 0.1, y: 0.1 }, "note", ["note"], 24, 0.4, 0.1, { color: "#000" }, 0);

      store.translateMemo(memo.id, 0.05, -0.02);

      const updated = store.getActive()[0];
      expect(updated.x).toBeCloseTo(0.15);
      expect(updated.y).toBeCloseTo(0.08);
    });

    it("枠の外に出そうな移動はキャンバスの枠にクランプされ、はみ出さない", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo({ x: 0.9, y: 0 }, "note", ["note"], 24, 0.4, 0.1, { color: "#000" }, 0);

      store.translateMemo(memo.id, 0.5, 0, canvasClamp); // (0.9,0) -> (1.4,0) のはずだがクランプされる

      const updated = store.getActive()[0];
      expect(isInsideClamp(updated, canvasClamp)).toBe(true);
      expect(updated.x).toBeCloseTo(1);
      expect(updated.y).toBeCloseTo(0);
    });

    it("テキストボックスの端が枠をはみ出さない範囲までしか移動しない（箱が枠内に収まる場合）", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo(
        { x: 0.4, y: 0.1 },
        "note",
        ["note"],
        24,
        0.4, // boxWidth -> halfW=0.2
        0.1, // boxHeight -> halfH=0.05
        { color: "#000" },
        0
      );

      store.translateMemo(memo.id, 0.5, 0, canvasClamp); // 中心だけなら(0.9,0)まで動けるが、箱の右端が枠をはみ出す

      const updated = store.getActive()[0];
      if (updated.kind !== "text") throw new Error("expected text memo");
      const halfW = updated.boxWidth / 2;
      const halfH = updated.boxHeight / 2;
      const corners = [
        { x: updated.x - halfW, y: updated.y - halfH },
        { x: updated.x + halfW, y: updated.y - halfH },
        { x: updated.x - halfW, y: updated.y + halfH },
        { x: updated.x + halfW, y: updated.y + halfH },
      ];
      for (const c of corners) {
        expect(isInsideClamp(c, canvasClamp)).toBe(true);
      }
      // 中心点だけをクランプする従来の実装なら中心はx=1まで動けてしまうため、
      // 箱の端を考慮した実装ではそれより手前で止まることを確認する。
      expect(updated.x).toBeLessThan(0.9);
    });
  });

  describe("eraseAt（消しゴム: 本当の手動削除）", () => {
    it("消しゴムが触れた部分だけを取り除き、線を分断する", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      // x=0..20 の直線を1本のストロークとして積む
      for (let x = 2; x <= 20; x += 2) {
        store.addPointToLastStroke(memo.id, { x, y: 0 });
      }

      // 中央 (x=10) を消す → 左右2本に分断されるはず
      const changed = store.eraseAt({ x: 10, y: 0 }, 2);
      expect(changed).toBe(true);
      const updated = store.getActive()[0];
      expect(updated.strokes.length).toBeGreaterThanOrEqual(2);
      // 消した場所の近くに点が残っていないこと
      const anyPointNearCenter = updated.strokes.flat().some((p) => Math.abs(p.x - 10) < 2);
      expect(anyPointNearCenter).toBe(false);
    });

    it("メモの全ストロークを消すとメモごと削除される", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.addPointToLastStroke(memo.id, { x: 1, y: 0 });
      store.addPointToLastStroke(memo.id, { x: 2, y: 0 });

      store.eraseAt({ x: 1, y: 0 }, 100); // 十分大きい半径で全消し
      expect(store.getActive()).toHaveLength(0);
      expect(store.getAll()).toHaveLength(0);
    });

    it("何にも触れなければ何も変わらない", () => {
      const store = new MemoStore();
      store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      const changed = store.eraseAt({ x: 9999, y: 9999 }, 5);
      expect(changed).toBe(false);
      expect(store.getActive()).toHaveLength(1);
    });
  });

  describe("undo/redo（issue #89: PC版のCtrl+Z/Ctrl+Shift+Z）", () => {
    it("履歴が無ければundo/redoは何もせずfalseを返す", () => {
      const store = new MemoStore();
      expect(store.undo()).toBe(false);
      expect(store.redo()).toBe(false);
    });

    it("snapshotForUndoの直後の変更をundoで取り消せる", () => {
      const store = new MemoStore();
      store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      expect(store.getAll()).toHaveLength(1);

      store.snapshotForUndo();
      store.createMemo({ x: 1, y: 1 }, STANDARD, 0);
      expect(store.getAll()).toHaveLength(2);

      expect(store.undo()).toBe(true);
      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0].x).toBe(0);
    });

    it("undoで戻した内容はredoでやり直せる", () => {
      const store = new MemoStore();
      store.snapshotForUndo();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);

      store.undo();
      expect(store.getAll()).toHaveLength(0);

      expect(store.redo()).toBe(true);
      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0].id).toBe(memo.id);
    });

    it("undoした後に新しい操作（snapshotForUndo）をすると、redo履歴は無効になる", () => {
      const store = new MemoStore();
      store.snapshotForUndo();
      store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.undo();
      expect(store.getAll()).toHaveLength(0);

      store.snapshotForUndo();
      store.createMemo({ x: 5, y: 5 }, STANDARD, 0);
      expect(store.redo()).toBe(false); // 新しい操作の後は、取り消したはずの内容には戻れない
      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0].x).toBe(5);
    });

    it("複数回のundo/redoを往復できる（スナップショットは複製で、参照を共有しない）", () => {
      const store = new MemoStore();
      store.snapshotForUndo();
      const memoA = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.snapshotForUndo();
      store.createMemo({ x: 1, y: 1 }, STANDARD, 0);
      expect(store.getAll()).toHaveLength(2);

      expect(store.undo()).toBe(true);
      expect(store.getAll()).toHaveLength(1);
      expect(store.undo()).toBe(true);
      expect(store.getAll()).toHaveLength(0);
      expect(store.undo()).toBe(false); // これ以上は戻れない

      expect(store.redo()).toBe(true);
      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0].id).toBe(memoA.id);
      expect(store.redo()).toBe(true);
      expect(store.getAll()).toHaveLength(2);
    });

    it("ストアを作り直しても（リロード相当）、undo/redoの履歴を引き継げる", () => {
      const store = new MemoStore();
      store.snapshotForUndo();
      store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.snapshotForUndo();
      store.createMemo({ x: 1, y: 1 }, STANDARD, 0);
      store.undo(); // 1つ戻した状態（redoも1つ残っている）

      const reloaded = new MemoStore();
      expect(reloaded.getAll()).toHaveLength(1);
      expect(reloaded.undo()).toBe(true); // もう1つ戻せる
      expect(reloaded.getAll()).toHaveLength(0);
      expect(reloaded.redo()).toBe(true);
      expect(reloaded.redo()).toBe(true); // 先ほどundoした分もやり直せる
      expect(reloaded.getAll()).toHaveLength(2);
    });

    it("resetAll・replaceAllは、保存済みの履歴も破棄する（作り直したストアでも戻せない）", () => {
      const a = new MemoStore();
      a.snapshotForUndo();
      a.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      a.resetAll();
      expect(new MemoStore().undo()).toBe(false);

      const b = new MemoStore();
      b.snapshotForUndo();
      b.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      b.replaceAll([]);
      expect(new MemoStore().undo()).toBe(false);
    });

    it("persistLocally=falseのストアは、履歴を保存も復元もしない", () => {
      const persistent = new MemoStore();
      persistent.snapshotForUndo();
      persistent.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      const transient = new MemoStore(undefined, false);
      expect(transient.undo()).toBe(false);
      transient.snapshotForUndo();
      expect(localStorage.getItem("memoHistory")).not.toBeNull(); // 上のpersistentが保存したぶんだけ
    });

    it("resetAllはundo/redoの履歴も破棄する", () => {
      const store = new MemoStore();
      store.snapshotForUndo();
      store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.resetAll();
      expect(store.undo()).toBe(false);
    });

    it("replaceAllはundo/redoの履歴も破棄する（tutorialSandbox.tsのシナリオ切り替え用）", () => {
      const store = new MemoStore();
      store.snapshotForUndo();
      store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.replaceAll([]);
      expect(store.undo()).toBe(false);
      expect(store.getAll()).toHaveLength(0);
    });

    it("消しゴム・移動など他の操作もundoで元に戻せる", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.addPointToLastStroke(memo.id, { x: 0.1, y: 0 });

      store.snapshotForUndo();
      store.translateMemo(memo.id, 0.2, 0.2);
      expect(store.getActive()[0].x).toBeCloseTo(0.2);
      store.undo();
      expect(store.getActive()[0].x).toBeCloseTo(0);

      store.snapshotForUndo();
      store.eraseAt({ x: 0, y: 0 }, 100);
      expect(store.getActive()).toHaveLength(0);
      store.undo();
      expect(store.getActive()).toHaveLength(1);
    });
  });
});
