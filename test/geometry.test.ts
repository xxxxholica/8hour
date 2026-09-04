import { describe, expect, it } from "vitest";
import {
  circleIntersectsBox,
  clampBoxCenter,
  clampToRoundedRect,
  eraseFromStroke,
  isInsideClamp,
  pointNearStroke,
  pointNearStrokes,
  pointToSegmentDistance,
} from "../src/geometry";

describe("clampToRoundedRect（キャンバスの枠：正方形・角丸）", () => {
  const roundedClamp = (p: { x: number; y: number }) => clampToRoundedRect(p, 1, 0.3);

  it("枠の内側の点はそのまま", () => {
    expect(clampToRoundedRect({ x: 0.1, y: 0.1 }, 1, 0.3)).toEqual({ x: 0.1, y: 0.1 });
  });

  it("辺の直線部分の外側は、その辺へ素直にクランプされる（角の丸め込みではない軸）", () => {
    // inner = half - cornerRadius = 0.7。y=0（|y|<=inner）は直線の辺に近いので、
    // x方向だけが辺(half=1)にクランプされる。
    const p = clampToRoundedRect({ x: 2, y: 0 }, 1, 0.3);
    expect(p).toEqual({ x: 1, y: 0 });
  });

  it("角の外側の点は、角の丸め半径の弧上に丸め込まれる", () => {
    const p = clampToRoundedRect({ x: 2, y: 2 }, 1, 0.3);
    expect(isInsideClamp(p, roundedClamp)).toBe(true);
    // 角の中心(0.7, 0.7)からの距離がちょうどcornerRadius(0.3)になる。
    expect(Math.hypot(p.x - 0.7, p.y - 0.7)).toBeCloseTo(0.3);
  });
});

describe("clampBoxCenter（テキストメモを新規に置く瞬間、箱の端が枠外に出ないようにする）", () => {
  const roundedClamp = (p: { x: number; y: number }) => clampToRoundedRect(p, 1, 0.3);

  it("箱が完全に収まる位置ならそのまま", () => {
    const p = clampBoxCenter({ x: 0.2, y: 0.1 }, 0.2, 0.05, roundedClamp);
    expect(p).toEqual({ x: 0.2, y: 0.1 });
  });

  it("境界近くをタップすると、箱の四隅すべてが境界内に収まる位置まで中心が引き寄せられる", () => {
    const halfW = 0.2;
    const halfH = 0.05;
    const p = clampBoxCenter({ x: 0.95, y: 0 }, halfW, halfH, roundedClamp);

    const corners = [
      { x: p.x - halfW, y: p.y - halfH },
      { x: p.x + halfW, y: p.y - halfH },
      { x: p.x - halfW, y: p.y + halfH },
      { x: p.x + halfW, y: p.y + halfH },
    ];
    for (const c of corners) {
      expect(isInsideClamp(c, roundedClamp)).toBe(true);
    }
    // 中心点だけをクランプする従来の実装ならx=0.95のまま(タップ位置をそのまま採用)
    // になってしまうため、箱の端を考慮してそれより手前に寄ることを確認する。
    expect(p.x).toBeLessThan(0.95);
  });

  it("原点に置いても収まりきらないほど巨大な箱は、原点（最善位置）に置かれる", () => {
    const p = clampBoxCenter({ x: 0.5, y: 0.5 }, 5, 5, roundedClamp);
    expect(p).toEqual({ x: 0, y: 0 });
  });
});

describe("pointToSegmentDistance", () => {
  it("線分の真上なら距離0", () => {
    expect(pointToSegmentDistance({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
  });

  it("端点より外側は端点までの距離になる", () => {
    const d = pointToSegmentDistance({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBe(5);
  });
});

describe("pointNearStroke / pointNearStrokes（手描きメモの当たり判定）", () => {
  const stroke = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it("しきい値内ならヒットする", () => {
    expect(pointNearStroke({ x: 5, y: 2 }, stroke, 5)).toBe(true);
  });

  it("しきい値より遠ければヒットしない", () => {
    expect(pointNearStroke({ x: 5, y: 50 }, stroke, 5)).toBe(false);
  });

  it("複数ストローク中のどれか一つに当たればヒット", () => {
    const other = [{ x: 100, y: 100 }, { x: 110, y: 100 }];
    expect(pointNearStrokes({ x: 5, y: 2 }, [other, stroke], 5)).toBe(true);
  });

  it("空のストロークにはヒットしない", () => {
    expect(pointNearStroke({ x: 0, y: 0 }, [], 100)).toBe(false);
  });
});

describe("eraseFromStroke（消しゴム）", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    { x: 15, y: 0 },
    { x: 20, y: 0 },
  ];

  it("中央を消すと左右2本に分断される", () => {
    const result = eraseFromStroke(line, { x: 10, y: 0 }, 3);
    expect(result).toHaveLength(2);
    expect(result[0].every((p) => p.x <= 5)).toBe(true);
    expect(result[1].every((p) => p.x >= 15)).toBe(true);
  });

  it("何も触れなければ1本のまま", () => {
    const result = eraseFromStroke(line, { x: 100, y: 100 }, 3);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(line);
  });

  it("全体を覆う半径で消すと何も残らない", () => {
    const result = eraseFromStroke(line, { x: 10, y: 0 }, 100);
    expect(result).toHaveLength(0);
  });

  it("1点だけ残る断片は捨てられる（線として成立しないため）", () => {
    const twoPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const result = eraseFromStroke(twoPoints, { x: 100, y: 0 }, 3);
    expect(result).toHaveLength(0);
  });
});

describe("circleIntersectsBox（テキストメモの当たり判定: 消しゴム）", () => {
  const box = { x: 0, y: 0, width: 10, height: 4 };

  it("矩形の内側なら重なっている", () => {
    expect(circleIntersectsBox({ x: 0, y: 0 }, 0.5, box)).toBe(true);
  });

  it("矩形からしきい値以内なら重なっている（辺の外側）", () => {
    expect(circleIntersectsBox({ x: 0, y: 3 }, 1.5, box)).toBe(true);
  });

  it("矩形から十分離れていれば重ならない", () => {
    expect(circleIntersectsBox({ x: 0, y: 100 }, 1, box)).toBe(false);
  });

  it("角に近い場合も正しく判定する", () => {
    // 矩形は x:[-5,5] y:[-2,2]。角(5,2)から少し外側の点。
    expect(circleIntersectsBox({ x: 6, y: 3 }, 1.5, box)).toBe(true);
    expect(circleIntersectsBox({ x: 6, y: 3 }, 1.3, box)).toBe(false);
  });
});
