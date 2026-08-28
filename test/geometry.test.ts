import { describe, expect, it } from "vitest";
import {
  circleIntersectsBox,
  clampBoxCenter,
  clampToCircle,
  clampToGlasses,
  eraseFromStroke,
  isInsideCircle,
  pointNearStroke,
  pointNearStrokes,
  pointToSegmentDistance,
} from "../src/geometry";

describe("clampToCircle", () => {
  it("円内の点はそのまま", () => {
    expect(clampToCircle({ x: 10, y: 10 }, 100)).toEqual({ x: 10, y: 10 });
  });

  it("円外の点は境界上に丸め込まれる", () => {
    const p = clampToCircle({ x: 200, y: 0 }, 100);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
    expect(isInsideCircle(p, 100)).toBe(true);
  });

  it("斜め方向でも半径ちょうどに収まる", () => {
    const p = clampToCircle({ x: 300, y: 400 }, 100);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(100);
  });
});

describe("clampBoxCenter（テキストメモを新規に置く瞬間、箱の端が枠外に出ないようにする）", () => {
  const circleClamp = (p: { x: number; y: number }) => clampToCircle(p, 1);

  it("箱が完全に収まる位置ならそのまま", () => {
    const p = clampBoxCenter({ x: 0.2, y: 0.1 }, 0.2, 0.05, circleClamp);
    expect(p).toEqual({ x: 0.2, y: 0.1 });
  });

  it("境界近くをタップすると、箱の四隅すべてが境界内に収まる位置まで中心が引き寄せられる", () => {
    const halfW = 0.2;
    const halfH = 0.05;
    const p = clampBoxCenter({ x: 0.95, y: 0 }, halfW, halfH, circleClamp);

    const corners = [
      { x: p.x - halfW, y: p.y - halfH },
      { x: p.x + halfW, y: p.y - halfH },
      { x: p.x - halfW, y: p.y + halfH },
      { x: p.x + halfW, y: p.y + halfH },
    ];
    for (const c of corners) {
      expect(Math.hypot(c.x, c.y)).toBeLessThanOrEqual(1 + 1e-9);
    }
    // 中心点だけをクランプする従来の実装ならx=0.95のまま(タップ位置をそのまま採用)
    // になってしまうため、箱の端を考慮してそれより手前に寄ることを確認する。
    expect(p.x).toBeLessThan(0.95);
  });

  it("原点に置いても収まりきらないほど巨大な箱は、原点（最善位置）に置かれる", () => {
    const p = clampBoxCenter({ x: 0.5, y: 0.5 }, 5, 5, circleClamp);
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

describe("pointNearStroke / pointNearStrokes（なぞって復活のヒット判定）", () => {
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

describe("clampToGlasses（眼鏡形状=左右レンズの和集合、ブリッジは書き込み不可）", () => {
  const centerOffset = 1.3;
  const clamp = (p: { x: number; y: number }) => clampToGlasses(p, (local) => clampToCircle(local, 1), centerOffset);

  it("右レンズの内側の点はそのまま", () => {
    expect(clamp({ x: centerOffset + 0.1, y: 0 })).toEqual({ x: centerOffset + 0.1, y: 0 });
  });

  it("左レンズの内側の点はそのまま", () => {
    expect(clamp({ x: -centerOffset - 0.1, y: 0 })).toEqual({ x: -centerOffset - 0.1, y: 0 });
  });

  it("ブリッジ（レンズの間）は書き込めない領域: 最も近いレンズの境界に丸め込まれる", () => {
    const p = clamp({ x: 0, y: 0.1 });
    expect(p).not.toEqual({ x: 0, y: 0.1 });
    expect(Math.hypot(Math.abs(p.x) - centerOffset, p.y)).toBeCloseTo(1, 5);
  });

  it("右レンズの外側の点は円周上に丸め込まれる", () => {
    const p = clamp({ x: centerOffset + 5, y: 0 });
    expect(Math.hypot(p.x - centerOffset, p.y)).toBeCloseTo(1);
  });

  it("両レンズの外側の点は、最も近い方のレンズの境界に丸め込まれる", () => {
    const p = clamp({ x: 0, y: 5 });
    expect(p.y).toBeLessThan(5);
    expect(Math.hypot(Math.abs(p.x) - centerOffset, p.y)).toBeCloseTo(1, 5);
  });

  it("クランプ結果は常にいずれかのレンズの内側（クランプの冪等性）", () => {
    const samples = [
      { x: 0, y: 0.5 },
      { x: 3, y: 3 },
      { x: -3, y: -3 },
      { x: 0.5, y: 1 },
    ];
    for (const p of samples) {
      const clamped = clamp(p);
      expect(clamp(clamped)).toEqual(clamped);
    }
  });
});

describe("circleIntersectsBox（テキストメモの当たり判定: なぞって復活・消しゴム）", () => {
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
