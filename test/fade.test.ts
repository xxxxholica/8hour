import { describe, expect, it } from "vitest";
import { computeOpacity, isFaded, opacityAtTime, remainingMs, MS_PER_DAY } from "../src/fade";

const H = 60 * 60 * 1000;
const D = MS_PER_DAY;

describe("computeOpacity — 標準ペン (lifespanDays = null, 固定7日カーブ)", () => {
  it("0〜24時間は100%", () => {
    expect(computeOpacity(0, null)).toBe(1);
    expect(computeOpacity(1 * H, null)).toBe(1);
    expect(computeOpacity(23.9 * H, null)).toBe(1);
  });

  it("24時間ちょうどで60%に切り替わる", () => {
    expect(computeOpacity(24 * H - 1, null)).toBe(1);
    expect(computeOpacity(24 * H, null)).toBe(0.6);
  });

  it("24時間〜3日は60%", () => {
    expect(computeOpacity(2 * D, null)).toBe(0.6);
    expect(computeOpacity(3 * D - 1, null)).toBe(0.6);
  });

  it("3日ちょうどで20%に切り替わる", () => {
    expect(computeOpacity(3 * D, null)).toBe(0.2);
  });

  it("3日〜7日は20%", () => {
    expect(computeOpacity(5 * D, null)).toBe(0.2);
    expect(computeOpacity(7 * D - 1, null)).toBe(0.2);
  });

  it("7日経過で完全消滅(0)", () => {
    expect(computeOpacity(7 * D, null)).toBe(0);
    expect(computeOpacity(30 * D, null)).toBe(0);
    expect(isFaded(7 * D, null)).toBe(true);
    expect(isFaded(7 * D - 1, null)).toBe(false);
  });

  it("負の経過時間（時計ずれなど）は100%として扱う", () => {
    expect(computeOpacity(-100, null)).toBe(1);
  });
});

describe("computeOpacity — 期間指定ペン: 今日中 (lifespanDays = 1, 書いた時刻から24h)", () => {
  const L = 1;
  it("書いた直後は100%", () => {
    expect(computeOpacity(0, L)).toBe(1);
  });

  it("24時間で必ず消滅する（『今日中』が当日残り時間ではなく丸1日である）", () => {
    expect(computeOpacity(24 * H - 1, L)).toBeGreaterThan(0);
    expect(computeOpacity(24 * H, L)).toBe(0);
    expect(isFaded(24 * H, L)).toBe(true);
  });

  it("標準カーブと同じ比率(1/7, 3/7)でスケールされる", () => {
    const to60 = (24 * H) / 7; // ≒ 3.43h
    const to20 = (24 * H * 3) / 7; // ≒ 10.29h
    expect(computeOpacity(to60 - 1, L)).toBe(1);
    expect(computeOpacity(to60 + 1, L)).toBe(0.6);
    expect(computeOpacity(to20 - 1, L)).toBe(0.6);
    expect(computeOpacity(to20 + 1, L)).toBe(0.2);
  });
});

describe("computeOpacity — 期間指定ペン: 3日 / 1週間", () => {
  it("3日指定は72時間で消滅する", () => {
    expect(computeOpacity(72 * H - 1, 3)).toBeGreaterThan(0);
    expect(computeOpacity(72 * H, 3)).toBe(0);
  });

  it("1週間指定は標準ペンと完全に一致する", () => {
    for (const elapsed of [0, 12 * H, 24 * H, 2 * D, 3 * D, 5 * D, 7 * D]) {
      expect(computeOpacity(elapsed, 7)).toBe(computeOpacity(elapsed, null));
    }
  });
});

describe("remainingMs", () => {
  it("経過0では丸ごとlifespan分が残る", () => {
    expect(remainingMs(0, 1)).toBe(1 * D);
    expect(remainingMs(0, null)).toBe(7 * D);
  });

  it("消滅後は0未満にならない", () => {
    expect(remainingMs(999 * D, 1)).toBe(0);
  });
});

describe("opacityAtTime（振り返りのタイムラインスライダー用）", () => {
  const createdAt = 1000 * D; // 適当な基準時刻

  it("作成前の時刻はnull（まだ存在しない）", () => {
    expect(opacityAtTime([createdAt], null, createdAt - 1)).toBeNull();
  });

  it("なぞり直しがない場合はcomputeOpacityと一致する", () => {
    for (const elapsed of [0, 12 * H, 3 * D, 6 * D, 7 * D]) {
      expect(opacityAtTime([createdAt], null, createdAt + elapsed)).toBe(
        computeOpacity(elapsed, null)
      );
    }
  });

  it("なぞり直した履歴を反映する（なぞり直し前は古い基準、直後は新しい基準で判定）", () => {
    const revivedAt = createdAt + 5 * D; // 5日後になぞって復活
    const history = [createdAt, revivedAt];

    // なぞり直す直前: 作成から5日弱経過 → 20%のはず
    expect(opacityAtTime(history, null, revivedAt - 1)).toBe(0.2);
    // なぞり直した瞬間: 100%に戻る
    expect(opacityAtTime(history, null, revivedAt)).toBe(1);
    // なぞり直しから2日後: そこからの経過として60%
    expect(opacityAtTime(history, null, revivedAt + 2 * D)).toBe(0.6);
  });

  it("履歴が空なら常にnull", () => {
    expect(opacityAtTime([], null, createdAt)).toBeNull();
  });
});
