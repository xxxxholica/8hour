import { describe, expect, it } from "vitest";
import {
  circleIntersectsBox,
  clampToRect,
  computeMemoDisplayOffset,
  computeResponsiveScale,
  eraseFromStroke,
  pointNearStroke,
  pointNearStrokes,
  pointToSegmentDistance,
} from "../src/geometry";
import type { StrokeMemo, TextMemo } from "../src/types";

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

describe("clampToRect / computeMemoDisplayOffset / computeResponsiveScale（全画面キャンバスのリサイズ追従）", () => {
  it("clampToRectは指定した半幅・半高の矩形内に点を収める", () => {
    expect(clampToRect({ x: 2.5, y: -1.8 }, 1.5, 1.2)).toEqual({ x: 1.5, y: -1.2 });
    expect(clampToRect({ x: 0.4, y: -0.3 }, 1.5, 1.2)).toEqual({ x: 0.4, y: -0.3 });
  });

  it("ウィンドウが大きい状態から小さくなれば要素を画面内へ引き寄せ、また大きくなれば元の広い位置へ戻す", () => {
    const memo: TextMemo = {
      id: "m1",
      kind: "text",
      x: 1.4,
      y: 0.8,
      text: "テスト",
      textLines: ["テスト"],
      fontSize: 18,
      boxWidth: 0.4,
      boxHeight: 0.2,
      createdAt: 1,
      status: "active",
      color: "oklch(22% 0.012 55)",
      align: "center",
      lineHeight: 1.35,
      originHalfW: 2.0,
      originHalfH: 1.2,
    };

    // 作成時と同じ広いウィンドウ（halfW=2.0, halfH=1.2）ではオフセット0
    expect(computeMemoDisplayOffset(memo, 2.0, 1.2)).toEqual({ x: 0, y: 0 });

    // ウィンドウが狭くなった（halfW=1.0, halfH=0.6）場合、外接矩形ごと画面内へ引き寄せられる
    const shrunkOffset = computeMemoDisplayOffset(memo, 1.0, 0.6);
    expect(shrunkOffset.x).toBeLessThan(0);
    expect(shrunkOffset.y).toBeLessThan(0);
    const displayedMaxX = memo.x + shrunkOffset.x + memo.boxWidth / 2;
    const displayedMaxY = memo.y + shrunkOffset.y + memo.boxHeight / 2;
    expect(displayedMaxX).toBeLessThanOrEqual(1.0 + 1e-6);
    expect(displayedMaxY).toBeLessThanOrEqual(0.6 + 1e-6);

    // 再びウィンドウを広げれば（halfW=2.2, halfH=1.5）、元の配置（オフセット0）に戻る
    expect(computeMemoDisplayOffset(memo, 2.2, 1.5)).toEqual({ x: 0, y: 0 });
  });

  it("computeResponsiveScaleは単一メモが画面幅を超える場合にスケールを縮小し、画面が広がれば基準スケールへ戻す", () => {
    const wideStrokeMemo: StrokeMemo = {
      id: "s1",
      kind: "stroke",
      x: -1.5,
      y: 0,
      strokes: [
        [
          { x: -1.5, y: 0 },
          { x: 1.5, y: 0 },
        ],
      ],
      createdAt: 1,
      status: "active",
      tool: "pen",
      color: "oklch(22% 0.012 55)",
      lineWidth: 3.5,
    };

    // 狭い画面幅（widthPx=300, baseScale=200）ではスパン3.0が収まるようスケールが縮む
    const smallScale = computeResponsiveScale(200, 300, 600, [wideStrokeMemo]);
    expect(smallScale).toBeLessThan(200);
    expect(smallScale * 3.0).toBeLessThanOrEqual(300);

    // 広い画面幅（widthPx=1200, baseScale=200）になれば元のbaseScale(200)に戻る
    const wideScale = computeResponsiveScale(200, 1200, 800, [wideStrokeMemo]);
    expect(wideScale).toBe(200);
  });

  it("computeResponsiveScaleは行モードの長文テキストでスケールが170未満に極小化しない", () => {
    const tallLineMemo: TextMemo = {
      id: "t1",
      kind: "text",
      x: 0,
      y: 0,
      text: "a\n".repeat(100),
      textLines: Array.from({ length: 100 }, () => "a"),
      fontSize: 24,
      boxWidth: 0.5,
      boxHeight: 10.0,
      createdAt: 1,
      status: "active",
      color: "oklch(22% 0.012 55)",
      align: "left",
      lineHeight: 1.4,
      layout: "line",
    };
    const scale = computeResponsiveScale(300, 1200, 800, [tallLineMemo]);
    expect(scale).toBe(170);
  });
});
