import { describe, expect, it } from "vitest";
import {
  buildAnyLensClamp,
  computeLensPairCenters,
  computeLensSplitPairCount,
  lensAbsoluteCenter,
  lensIndexToPairSlot,
  nearestLensIndexForPosition,
  LENS_COUNT,
} from "../src/lensSplit";

describe("computeLensSplitPairCount（issue #79: 参加人数以上の眼鏡が用意される問題）", () => {
  it("2人につき1組を目安に切り上げる", () => {
    expect(computeLensSplitPairCount(2)).toBe(1);
    expect(computeLensSplitPairCount(3)).toBe(2);
    expect(computeLensSplitPairCount(4)).toBe(2);
  });

  it("1人でも最低1組は用意する", () => {
    expect(computeLensSplitPairCount(1)).toBe(1);
  });

  it("LENS_COUNT(4)を超える参加人数は、レンズ分割の対象外の人数を組数に数えない(3組は表示が不安定なため上限2組)", () => {
    expect(computeLensSplitPairCount(5)).toBe(2);
    expect(computeLensSplitPairCount(8)).toBe(2);
    expect(LENS_COUNT).toBe(4);
  });
});

describe("computeLensPairCenters", () => {
  it("1組の時は原点1点だけ(レンズ分割無効時と同じ結果になり回帰しない)", () => {
    expect(computeLensPairCenters("row", 1)).toEqual([{ x: 0, y: 0 }]);
    expect(computeLensPairCenters("column", 1)).toEqual([{ x: 0, y: 0 }]);
  });

  it("row方向はx軸上に、中央が原点になるよう対称に並ぶ", () => {
    const centers = computeLensPairCenters("row", 3);
    expect(centers).toHaveLength(3);
    expect(centers[1]).toEqual({ x: 0, y: 0 });
    expect(centers[0].y).toBe(0);
    expect(centers[2].y).toBe(0);
    expect(centers[0].x).toBeCloseTo(-centers[2].x);
    expect(centers[0].x).toBeLessThan(centers[1].x);
    expect(centers[1].x).toBeLessThan(centers[2].x);
  });

  it("column方向はy軸上に、隣接する組同士が均等な間隔で並ぶ", () => {
    const centers = computeLensPairCenters("column", 2);
    expect(centers).toHaveLength(2);
    expect(centers[0].x).toBe(0);
    expect(centers[1].x).toBe(0);
    expect(centers[0].y).toBeCloseTo(-centers[1].y);
  });
});

describe("lensIndexToPairSlot", () => {
  it("レンズ番号を組番号・左右に変換する(偶数=right, 奇数=left)", () => {
    expect(lensIndexToPairSlot(0)).toEqual({ pairIndex: 0, side: "right" });
    expect(lensIndexToPairSlot(1)).toEqual({ pairIndex: 0, side: "left" });
    expect(lensIndexToPairSlot(2)).toEqual({ pairIndex: 1, side: "right" });
    expect(lensIndexToPairSlot(5)).toEqual({ pairIndex: 2, side: "left" });
  });
});

describe("buildAnyLensClamp（issue #114/#119: discussion中のマスターの書き込み・voting中の投票が、原点から離れた2組目以降のレンズにも届く必要がある）", () => {
  // 全組"round"(半径1の円クランプ、frameShape.ts参照)を使う——このテストの関心は
  // クランプ形状ではなく「組をまたいで正しいレンズを探せているか」なので十分。
  const frameShapeIdForPair = () => "round" as const;

  it("2組目(原点から離れた組)のレンズ内の点は、クランプで動かされず素通りする", () => {
    const pairCenters = computeLensPairCenters("row", 2);
    const clamp = buildAnyLensClamp(frameShapeIdForPair, pairCenters);
    // レンズ4(0-3)のうち、あえて原点から一番遠い組1側(lensIndex 2, 3)の中心を使う
    // ——単一形状・原点中心のclampへ誤って戻すと、この点はクランプ対象外(範囲外)
    // に見えてしまう回帰が起きる(discussionで実際に踏んだ不具合)。
    const farLensCenter = lensAbsoluteCenter(pairCenters, 2);
    expect(clamp(farLensCenter)).toEqual(farLensCenter);
  });

  it("いずれのレンズの範囲内でもない点は、最も近いレンズの境界へ丸め込まれる", () => {
    const pairCenters = computeLensPairCenters("row", 2);
    const clamp = buildAnyLensClamp(frameShapeIdForPair, pairCenters);
    const farAway = { x: 1000, y: 0 };
    const clamped = clamp(farAway);
    expect(clamped).not.toEqual(farAway);
    // 丸め込み先はどれかのレンズの中心から半径1(roundClampの範囲)以内のはず。
    const distances = [0, 1, 2, 3].map((lensIndex) => {
      const c = lensAbsoluteCenter(pairCenters, lensIndex);
      return Math.hypot(clamped.x - c.x, clamped.y - c.y);
    });
    expect(Math.min(...distances)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("組が1つだけ(pairCount=1)の時は、レンズ分割無効時と実質同じ範囲(左右2レンズ)になる", () => {
    const pairCenters = computeLensPairCenters("row", 1);
    const clamp = buildAnyLensClamp(frameShapeIdForPair, pairCenters);
    const rightLensCenter = lensAbsoluteCenter(pairCenters, 0);
    const leftLensCenter = lensAbsoluteCenter(pairCenters, 1);
    expect(clamp(rightLensCenter)).toEqual(rightLensCenter);
    expect(clamp(leftLensCenter)).toEqual(leftLensCenter);
  });
});

describe("nearestLensIndexForPosition（issue #114/#119: discussion中のマスターの書き込みはDEFAULT_INKで参加者色を持たないため、色ではなく位置でレンズを判定する必要がある）", () => {
  it("各レンズの中心そのものは、そのレンズ番号を返す", () => {
    const pairCenters = computeLensPairCenters("row", 2);
    for (let lensIndex = 0; lensIndex < 4; lensIndex++) {
      const center = lensAbsoluteCenter(pairCenters, lensIndex);
      expect(nearestLensIndexForPosition(pairCenters, center)).toBe(lensIndex);
    }
  });

  it("2組目寄りの点は2組目のレンズ番号を返す(1組目に引きずられない)", () => {
    const pairCenters = computeLensPairCenters("row", 2);
    const nearLens2 = lensAbsoluteCenter(pairCenters, 2);
    const point = { x: nearLens2.x + 0.1, y: nearLens2.y + 0.1 };
    expect(nearestLensIndexForPosition(pairCenters, point)).toBe(2);
  });
});
