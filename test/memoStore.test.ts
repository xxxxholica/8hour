import { beforeEach, describe, expect, it } from "vitest";
import { CANVAS_FRAME_SHAPE } from "../src/frameShape";
import { isInsideClamp } from "../src/geometry";
import { MemoStore } from "../src/memoStore";
import type { MemoStyle } from "../src/types";

const canvasClamp = (p: { x: number; y: number }) => CANVAS_FRAME_SHAPE.clamp(p);

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

    it("枠の外に出そうな移動はキャンバスの枠（正方形・角丸）にクランプされ、はみ出さない", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo({ x: 0.9, y: 0 }, "note", ["note"], 24, 0.4, 0.1, { color: "#000" }, 0);

      store.translateMemo(memo.id, 0.5, 0); // (0.9,0) -> (1.4,0) のはずだがクランプされる

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

      store.translateMemo(memo.id, 0.5, 0); // 中心だけなら(0.9,0)まで動けるが、箱の右端が枠をはみ出す

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

  describe("insertCopy（過去めくり画面のドロップ帯からの持ち越し、E3-03/04）", () => {
    const JITTER = 0.03; // src/memoStore.tsのCOPY_POSITION_JITTERと同じ値

    it("形（相対座標）を保ったまま、元のメモと同じ位置（±ランダムオフセット）に配置する", () => {
      const archived = {
        id: "memo_archived",
        kind: "stroke" as const,
        x: -0.1, // 代表座標は最初のストロークの始点と一致させる（types.tsの規約通り）
        y: 0,
        strokes: [
          [
            { x: -0.1, y: 0 },
            { x: 0.1, y: 0 },
          ],
        ],
        createdAt: 100,
        status: "active" as const,
        tool: "pen" as const,
        color: "#000000",
      };
      const store = new MemoStore();
      const copy = store.insertCopy(archived);

      expect(copy.kind).toBe("stroke");
      // ジッターの範囲内（±JITTER）に収まっている
      expect(Math.abs(copy.x - archived.x)).toBeLessThanOrEqual(JITTER + 1e-9);
      expect(Math.abs(copy.y - archived.y)).toBeLessThanOrEqual(JITTER + 1e-9);
      if (copy.kind === "stroke") {
        // ストローク内の相対的な形（2点間の距離）は変わらない——ジッターは
        // 全体を平行移動するだけで、形そのものは歪めない
        const [p0, p1] = copy.strokes[0];
        expect(p1.x - p0.x).toBeCloseTo(0.2);
        expect(p1.y - p0.y).toBeCloseTo(0);
      }
    });

    it("新しいid・createdAtを持つ（元のメモとは別物）", () => {
      const archived = {
        id: "memo_archived",
        kind: "stroke" as const,
        x: 0,
        y: 0,
        strokes: [[{ x: 0, y: 0 }, { x: 0.05, y: 0.05 }]],
        createdAt: 100,
        status: "active" as const,
        tool: "pen" as const,
        color: "#000000",
      };
      const store = new MemoStore();
      const copy = store.insertCopy(archived);

      expect(copy.id).not.toBe(archived.id);
      expect(copy.createdAt).not.toBe(100);
    });

    it("渡した元のメモ（アーカイブ側）は一切変更しない（複製であって移動ではない）", () => {
      const archived = {
        id: "memo_archived",
        kind: "stroke" as const,
        x: 0,
        y: 0,
        strokes: [[{ x: 0, y: 0 }, { x: 0.05, y: 0.05 }]],
        createdAt: 100,
        status: "active" as const,
        tool: "pen" as const,
        color: "#000000",
      };
      const originalSnapshot = structuredClone(archived);
      const store = new MemoStore();
      store.insertCopy(archived);

      expect(archived).toEqual(originalSnapshot);
    });

    it("元の位置が枠の縁付近でも、ジッターで枠外へはみ出す場合は枠内にクランプされる", () => {
      // 枠の縁ぎりぎり(x=0.999)に置く——ジッターがどちらへ転んでも、外側へ
      // 出る側の結果は必ずクランプされる（内側へ転んだ場合はクランプ不要のまま）
      const archived = {
        id: "memo_archived",
        kind: "stroke" as const,
        x: 0.999,
        y: 0,
        strokes: [[{ x: 0.999, y: 0 }, { x: 1.019, y: 0 }]],
        createdAt: 100,
        status: "active" as const,
        tool: "pen" as const,
        color: "#000000",
      };
      const store = new MemoStore();
      for (let i = 0; i < 20; i++) {
        const copy = store.insertCopy(archived, canvasClamp);
        expect(isInsideClamp({ x: copy.x, y: copy.y }, canvasClamp)).toBe(true);
      }
    });

    it("複製した結果はlocalStorageにも永続化される", () => {
      const archived = {
        id: "memo_archived",
        kind: "text" as const,
        x: 0,
        y: 0,
        text: "hello",
        textLines: ["hello"],
        fontSize: 24,
        boxWidth: 0.3,
        boxHeight: 0.1,
        createdAt: 100,
        status: "active" as const,
        color: "#000000",
      };
      const store = new MemoStore();
      store.insertCopy(archived);

      const reloaded = new MemoStore();
      expect(reloaded.getAll()).toHaveLength(1);
      expect(reloaded.getAll()[0].kind).toBe("text");
    });
  });
});
