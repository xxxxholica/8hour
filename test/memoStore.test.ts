import { beforeEach, describe, expect, it } from "vitest";
import { MemoStore } from "../src/memoStore";
import type { MemoStyle } from "../src/types";

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

const STANDARD: MemoStyle = { tool: "pen", color: "#2f2a26", lifespanDays: null };
const TODAY: MemoStyle = { tool: "pen", color: "#2f2a26", lifespanDays: 1 };

describe("MemoStore", () => {
  it("作成したメモはlocalStorageから復元できる（リロード耐性）", () => {
    const store = new MemoStore();
    store.createMemo({ x: 1, y: 2 }, STANDARD, 1000);

    const reloaded = new MemoStore();
    expect(reloaded.getAll()).toHaveLength(1);
    expect(reloaded.getAll()[0].lifespanDays).toBeNull();
    expect(reloaded.getAll()[0].tool).toBe("pen");
    expect(reloaded.getAll()[0].color).toBe("#2f2a26");
    expect(reloaded.getAll()[0].traceHistory).toEqual([1000]);
  });

  it("なぞって復活させるたびにtraceHistoryへ時刻が追記される（タイムライン再現用）", () => {
    const store = new MemoStore();
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    expect(store.getAll()[0].traceHistory).toEqual([0]);

    // クールタイム(寿命7日の10%=0.7日)より十分に間隔を空けて2回なぞる。
    const oneDay = 24 * 60 * 60 * 1000;
    const twoDays = 2 * oneDay;
    store.reviveMemo(memo.id, oneDay);
    store.reviveMemo(memo.id, twoDays);
    expect(store.getAll()[0].traceHistory).toEqual([0, oneDay, twoDays]);
    expect(store.getAll()[0].lastTracedAt).toBe(twoDays);
  });

  it("7日経過でtickするとstatusがfadedになり、キャンバスから消える", () => {
    const store = new MemoStore();
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);

    const justBefore = 7 * 24 * 60 * 60 * 1000 - 1;
    store.tick(justBefore);
    expect(store.getActive()).toHaveLength(1);
    expect(store.getFaded()).toHaveLength(0);

    const exactly7Days = 7 * 24 * 60 * 60 * 1000;
    const changed = store.tick(exactly7Days);
    expect(changed).toBe(true);
    expect(store.getActive()).toHaveLength(0);
    expect(store.getFaded()).toHaveLength(1);
    expect(store.getFaded()[0].id).toBe(memo.id);
  });

  it("なぞって復活させても1回では寿命の15%ぶんしか猶予が戻らない（無条件のフル回復ではない）", () => {
    const store = new MemoStore();
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);

    const threeDays = 3 * 24 * 60 * 60 * 1000;
    store.tick(threeDays);
    expect(store.opacityOf(store.getActive()[0], threeDays)).toBe(0.2);

    // 1回のなぞりでは寿命(7日)の15%ぶん(=1.05日)しか経過時計を戻さないため、
    // 一段階(0.6)までしか回復しない。
    store.reviveMemo(memo.id, threeDays);
    expect(store.opacityOf(store.getActive()[0], threeDays)).toBe(0.6);

    // 復活後はそこから新たに7日でまた消える
    const afterFirstRevive = store.getActive()[0].lastTracedAt;
    store.tick(afterFirstRevive + 7 * 24 * 60 * 60 * 1000 - 1);
    expect(store.getActive()).toHaveLength(1);
    store.tick(afterFirstRevive + 7 * 24 * 60 * 60 * 1000);
    expect(store.getActive()).toHaveLength(0);
  });

  it("クールタイムは無く、同じ時刻でも間を置かず何度でもなぞって復活できる（1日上限がある今、頻度を制限する理由がないため撤廃）", () => {
    const store = new MemoStore();
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    store.tick(threeDays);

    store.reviveMemo(memo.id, threeDays);
    expect(store.opacityOf(store.getActive()[0], threeDays)).toBe(0.6);

    // 同じ時刻で間を置かずもう一度なぞっても、まだ経過時間に余裕があるぶん
    // そのままもう15%戻り、今回はそれで100%に戻る。
    store.reviveMemo(memo.id, threeDays);
    expect(store.opacityOf(store.getActive()[0], threeDays)).toBe(1);

    // 100%表示になった後も、経過時間がまだ0でない間はなぞるたびに「今」へ
    // 近づき続け、最終的にちょうど「今」に追いつく。
    store.reviveMemo(memo.id, threeDays);
    expect(store.getActive()[0].lastTracedAt).toBe(threeDays);

    // 追いついた後にもう一度なぞっても、これ以上経過時間を削れないので変化しない
    // （クールタイムではなく、単に「戻す先がもう無い」ため）。
    store.reviveMemo(memo.id, threeDays);
    expect(store.getActive()[0].lastTracedAt).toBe(threeDays);
  });

  it("今日中（lifespanDays=1）は24時間で消える", () => {
    const store = new MemoStore();
    store.createMemo({ x: 0, y: 0 }, TODAY, 0);

    store.tick(24 * 60 * 60 * 1000 - 1);
    expect(store.getActive()).toHaveLength(1);
    store.tick(24 * 60 * 60 * 1000);
    expect(store.getActive()).toHaveLength(0);
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

  it("なぞる1回ぶんの回復量は寿命の15%まで、かつ今を超えて未来にはしない", () => {
    const store = new MemoStore();
    // TODAY: lifespanDays=1（24時間）。15%=3.6時間
    const memo = store.createMemo({ x: 0, y: 0 }, TODAY, 0);
    const oneDayMs = 24 * 60 * 60 * 1000;
    const fifteenPercentMs = oneDayMs * 0.15;

    // 半日経過した時点でなぞる：経過時間(12h)は15%ぶん(3.6h)より大きいので、
    // 15%ぶんそのものが1回の回復量になる。
    const halfDay = oneDayMs / 2;
    store.reviveMemo(memo.id, halfDay);
    expect(store.getActive()[0].lastTracedAt).toBe(fifteenPercentMs);

    const status = store.reviveStatusOf(memo.id, halfDay)!;
    expect(status.remainingMs).toBe(oneDayMs - (halfDay - fifteenPercentMs));
  });

  it("経過時間が15%ぶんより短い状態でなぞると、経過時間ぶんしか戻らない（未来の時刻を経過済み扱いにはしない）", () => {
    const store = new MemoStore();
    const memo = store.createMemo({ x: 0, y: 0 }, TODAY, 0); // lifespanDays=1（24時間）
    const oneDayMs = 24 * 60 * 60 * 1000;
    const tinyElapsed = oneDayMs * 0.05; // 15%より短い経過時間

    store.reviveMemo(memo.id, tinyElapsed);
    expect(store.getActive()[0].lastTracedAt).toBe(tinyElapsed);

    // 経過時間ぶんだけ戻ってちょうど「今」に追いついたので、同じ時刻で
    // 再度なぞってもクールタイム中なので変化しない。
    store.reviveMemo(memo.id, tinyElapsed);
    expect(store.getActive()[0].lastTracedAt).toBe(tinyElapsed);
  });

  it("なぞって回復できる回数・頻度に上限はない：間隔を空けても詰めても何度でも復活できる（Issue #11の総量制限は撤廃）", () => {
    const store = new MemoStore();
    const memo = store.createMemo({ x: 0, y: 0 }, TODAY, 0); // lifespanDays=1
    const oneDayMs = 24 * 60 * 60 * 1000;

    // 1日ぶんの間隔を空けてなぞり直すことを20回繰り返す。総量制限もクール
    // タイムも無いため、いつまでも同じように回復し続けられる。
    let now = 0;
    for (let i = 0; i < 20; i++) {
      now += oneDayMs; // 前回のなぞりから丸1日分の余裕を空ける
      const before = store.getActive()[0].lastTracedAt;
      store.reviveMemo(memo.id, now);
      expect(store.getActive()[0].lastTracedAt).toBeGreaterThan(before);
    }
    expect(store.getActive()).toHaveLength(1);
  });

  it("faded済みメモをreviveMemoしても復活しない（アーカイブは非対話）", () => {
    const store = new MemoStore();
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    store.tick(7 * 24 * 60 * 60 * 1000);
    expect(store.getFaded()).toHaveLength(1);

    store.reviveMemo(memo.id, 7 * 24 * 60 * 60 * 1000 + 1);
    expect(store.getActive()).toHaveLength(0);
    expect(store.getFaded()).toHaveLength(1);
  });

  describe("nudgeMemoClock（選択道具でメモを掴んで振り回す操作専用）", () => {
    it("deltaMsぶんlastTracedAtを直接ずらす。負なら経過時間が増える（進める）", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, TODAY, 0); // lifespanDays=1（24時間）
      const fourHoursMs = 4 * 60 * 60 * 1000;

      store.nudgeMemoClock(memo.id, -fourHoursMs);
      expect(store.getActive()[0].lastTracedAt).toBe(-fourHoursMs);
      // 4時間経過/24時間 = 1/6 > 1/7(60%へ落ちる境界)なので一段階(0.6)まで進む
      expect(store.opacityOf(store.getActive()[0], 0)).toBe(0.6);
    });

    it("正なら「今」に近づく側（復活）", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, TODAY, 0);
      const oneHourMs = 60 * 60 * 1000;

      store.nudgeMemoClock(memo.id, -oneHourMs);
      store.nudgeMemoClock(memo.id, oneHourMs);
      expect(store.getActive()[0].lastTracedAt).toBe(0);
    });

    it("cap・クールタイムは無く、間を置かず何度でも呼べる（1日上限がある今、頻度を制限する理由がないため撤廃）", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, TODAY, 0);
      const oneHourMs = 60 * 60 * 1000;

      store.nudgeMemoClock(memo.id, -oneHourMs);
      const afterFirst = store.getActive()[0].lastTracedAt;
      store.nudgeMemoClock(memo.id, -oneHourMs);
      expect(store.getActive()[0].lastTracedAt).toBe(afterFirst - oneHourMs);
    });

    it("なぞった履歴（traceHistory）には残さない（振り回しは『なぞった』わけではない）", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, TODAY, 0);
      store.nudgeMemoClock(memo.id, -60 * 60 * 1000);
      expect(store.getActive()[0].traceHistory).toEqual([0]);
    });

    it("繰り返して寿命に到達させると、tickでfadedになる", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, TODAY, 0); // lifespanDays=1（24時間）
      const oneHourMs = 60 * 60 * 1000;

      for (let i = 0; i < 25; i++) {
        store.nudgeMemoClock(memo.id, -oneHourMs);
      }
      store.tick(0);
      expect(store.getActive()).toHaveLength(0);
      expect(store.getFaded()).toHaveLength(1);
      expect(store.getFaded()[0].id).toBe(memo.id);
    });

    it("faded済みメモをnudgeMemoClockしても何も起きない", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.tick(7 * 24 * 60 * 60 * 1000);
      expect(store.getFaded()).toHaveLength(1);

      store.nudgeMemoClock(memo.id, 60 * 60 * 1000);
      expect(store.getActive()).toHaveLength(0);
      expect(store.getFaded()).toHaveLength(1);
    });
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
        { color: "#2f2a26", lifespanDays: null },
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
      const memo = store.createTextMemo(
        { x: 0, y: 0 },
        "note",
        ["note"],
        24,
        0.5,
        0.1,
        { color: "#000", lifespanDays: null },
        0
      );
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
      store.createTextMemo(
        { x: 0, y: 0 },
        "note",
        ["note"],
        24,
        0.4,
        0.1,
        { color: "#000", lifespanDays: null },
        0
      );
      expect(store.getActive()).toHaveLength(1);

      const changed = store.eraseAt({ x: 0.05, y: 0 }, 0.02);
      expect(changed).toBe(true);
      expect(store.getActive()).toHaveLength(0);
    });

    it("消しゴムがテキストのボックスから離れていれば消えない", () => {
      const store = new MemoStore();
      store.createTextMemo(
        { x: 0, y: 0 },
        "note",
        ["note"],
        24,
        0.4,
        0.1,
        { color: "#000", lifespanDays: null },
        0
      );
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
      const memo = store.createTextMemo(
        { x: 0.1, y: 0.1 },
        "note",
        ["note"],
        24,
        0.4,
        0.1,
        { color: "#000", lifespanDays: null },
        0
      );

      store.translateMemo(memo.id, 0.05, -0.02);

      const updated = store.getActive()[0];
      expect(updated.x).toBeCloseTo(0.15);
      expect(updated.y).toBeCloseTo(0.08);
    });

    it("円の外に出そうな移動は半径1にクランプされ、円からはみ出さない", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo(
        { x: 0.9, y: 0 },
        "note",
        ["note"],
        24,
        0.4,
        0.1,
        { color: "#000", lifespanDays: null },
        0
      );

      store.translateMemo(memo.id, 0.5, 0); // (0.9,0) -> (1.4,0) のはずだがクランプされる

      const updated = store.getActive()[0];
      const d = Math.hypot(updated.x, updated.y);
      expect(d).toBeLessThanOrEqual(1 + 1e-9);
      expect(updated.x).toBeCloseTo(1);
      expect(updated.y).toBeCloseTo(0);
    });

    it("テキストボックスの端が円をはみ出さない範囲までしか移動しない（箱が枠内に収まる場合）", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo(
        { x: 0.4, y: 0.1 },
        "note",
        ["note"],
        24,
        0.4, // boxWidth -> halfW=0.2
        0.1, // boxHeight -> halfH=0.05
        { color: "#000", lifespanDays: null },
        0
      );

      store.translateMemo(memo.id, 0.5, 0); // 中心だけなら(0.9,0)まで動けるが、箱の右端が円をはみ出す

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
        expect(Math.hypot(c.x, c.y)).toBeLessThanOrEqual(1 + 1e-9);
      }
      // 中心点だけをクランプする従来の実装なら中心はx=1まで動けてしまうため、
      // 箱の端を考慮した実装ではそれより手前で止まることを確認する。
      expect(updated.x).toBeLessThan(0.9);
    });

    it("消滅済み（振り返りビュー）のメモは動かせない", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.tick(7 * 24 * 60 * 60 * 1000);
      expect(store.getFaded()).toHaveLength(1);

      store.translateMemo(memo.id, 0.5, 0.5);

      const stillFaded = store.getFaded()[0];
      expect(stillFaded.x).toBe(0);
      expect(stillFaded.y).toBe(0);
    });

    it("移動はなぞって復活と無関係：traceHistory/lastTracedAtは変化しない", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      const before = store.getActive()[0].traceHistory.slice();
      const beforeTracedAt = store.getActive()[0].lastTracedAt;

      store.translateMemo(memo.id, 0.1, 0.1);

      const updated = store.getActive()[0];
      expect(updated.traceHistory).toEqual(before);
      expect(updated.lastTracedAt).toBe(beforeTracedAt);
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
      const anyPointNearCenter = updated.strokes
        .flat()
        .some((p) => Math.abs(p.x - 10) < 2);
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

    it("消滅済み（振り返りビュー）のメモには影響しない", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.addPointToLastStroke(memo.id, { x: 1, y: 0 });
      store.tick(7 * 24 * 60 * 60 * 1000);
      expect(store.getFaded()).toHaveLength(1);

      store.eraseAt({ x: 0, y: 0 }, 100);
      expect(store.getFaded()).toHaveLength(1);
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

    it("replaceAllはundo/redoの履歴も破棄する（サーバー側の内容で丸ごと置き換わるため）", () => {
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

describe("共有キャンバス用のonOp（メモ単位の操作通知、issue #99）", () => {
  it("createMemoは作成したメモをupsertsとして通知する", () => {
    const ops: { upserts: { id: string }[]; deletes: string[] }[] = [];
    const store = new MemoStore(undefined, false, (op) => ops.push(op));
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);

    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ upserts: [memo], deletes: [] });
  });

  it("メモを編集する操作（追記・移動）は、そのメモをupsertsとして通知する", () => {
    const ops: { upserts: { id: string }[]; deletes: string[] }[] = [];
    const store = new MemoStore(undefined, false, (op) => ops.push(op));
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    ops.length = 0;

    store.addPointToLastStroke(memo.id, { x: 0.1, y: 0 });
    expect(ops).toEqual([{ upserts: [memo], deletes: [] }]);

    ops.length = 0;
    store.translateMemo(memo.id, 0.1, 0.1);
    expect(ops).toEqual([{ upserts: [memo], deletes: [] }]);
  });

  it("translateMemoが実際には動けなかった場合（境界一杯など）は通知しない", () => {
    const ops: unknown[] = [];
    const store = new MemoStore(undefined, false, (op) => ops.push(op));
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    ops.length = 0;

    store.translateMemo(memo.id, 0, 0); // dx=dy=0なので何も起きない
    expect(ops).toHaveLength(0);
  });

  it("deleteMemoは削除したIDをdeletesとして通知する。存在しないIDでは通知しない", () => {
    const ops: { upserts: unknown[]; deletes: string[] }[] = [];
    const store = new MemoStore(undefined, false, (op) => ops.push(op));
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    ops.length = 0;

    store.deleteMemo("no-such-id");
    expect(ops).toHaveLength(0);

    store.deleteMemo(memo.id);
    expect(ops).toEqual([{ upserts: [], deletes: [memo.id] }]);
  });

  it("eraseAtは、消え切ったメモはdeletesに、一部だけ消えたメモはupsertsに振り分けて通知する", () => {
    const ops: { upserts: { id: string }[]; deletes: string[] }[] = [];
    const store = new MemoStore(undefined, false, (op) => ops.push(op));
    // 完全に消される予定のメモ(原点付近の1点)
    const erased = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    // 一部だけ消される予定のメモ: 原点の点を消しても、残り2点(半径外)で
    // ストロークとして生き残るよう3点で作る(eraseFromStrokeは1点だけの
    // 断片は消え残りとして扱わないため、geometry.ts参照)。
    const partial = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    store.addPointToLastStroke(partial.id, { x: 0.5, y: 0 });
    store.addPointToLastStroke(partial.id, { x: 0.9, y: 0 });
    ops.length = 0;

    store.eraseAt({ x: 0, y: 0 }, 0.05);

    expect(ops).toHaveLength(1);
    expect(ops[0].deletes).toEqual([erased.id]);
    expect(ops[0].upserts.map((m) => m.id)).toEqual([partial.id]);
  });

  it("applyRemoteUpsert/applyRemoteDeleteは、取り込んだ内容をonOp/onChangeへ押し戻さない", () => {
    const ops: unknown[] = [];
    const changes: unknown[] = [];
    const store = new MemoStore((memos) => changes.push(memos), false, (op) => ops.push(op));
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    ops.length = 0;
    changes.length = 0;

    store.applyRemoteUpsert({ ...memo, x: 0.5 });
    expect(store.getAll()[0].x).toBe(0.5);
    expect(ops).toHaveLength(0);
    expect(changes).toHaveLength(0);

    store.applyRemoteDelete(memo.id);
    expect(store.getAll()).toHaveLength(0);
    expect(ops).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });
});
