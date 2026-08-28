import { describe, expect, it } from "vitest";
import {
  FONT_SIZE_STEPS,
  MIN_FONT_PX,
  REFERENCE_TEXT_BOX_WIDTH_PX,
  fontPxForRender,
  normalizedBoxSize,
  wrapTextAtReferenceScale,
} from "../src/textLayout";
import { REFERENCE_RADIUS } from "../src/toolStyle";

// vitestはjsdomを使わないため、measureTextを単純な等幅近似でモックする最小限のcanvas contextを用意する
function makeFakeCtx(charWidth = 10): CanvasRenderingContext2D {
  let font = "";
  return {
    get font() {
      return font;
    },
    set font(v: string) {
      font = v;
    },
    measureText: (text: string) => ({ width: text.length * charWidth }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}

describe("fontPxForRender（文字サイズの下限）", () => {
  it("基準半径ではそのままの大きさになる", () => {
    expect(fontPxForRender(24, REFERENCE_RADIUS)).toBe(24);
  });

  it("半径が小さくなるとフォントも小さくなる", () => {
    expect(fontPxForRender(24, REFERENCE_RADIUS / 2)).toBeCloseTo(12);
  });

  it("下限(MIN_FONT_PX)より小さくはならない", () => {
    expect(fontPxForRender(24, 10)).toBe(MIN_FONT_PX);
    expect(fontPxForRender(FONT_SIZE_STEPS.small, 1)).toBe(MIN_FONT_PX);
  });
});

describe("wrapTextAtReferenceScale（行分割）", () => {
  it("幅に収まる短いテキストは1行のまま", () => {
    const ctx = makeFakeCtx(10);
    const lines = wrapTextAtReferenceScale(ctx, "abc", 24);
    expect(lines).toEqual(["abc"]);
  });

  it("幅を超えると複数行に折り返す", () => {
    const ctx = makeFakeCtx(10);
    // 1文字10px、幅REFERENCE_TEXT_BOX_WIDTH_PXなので、それを超える文字数なら折り返るはず
    const text = "a".repeat(Math.ceil(REFERENCE_TEXT_BOX_WIDTH_PX / 10) + 5);
    const lines = wrapTextAtReferenceScale(ctx, text, 24);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(text);
  });

  it("改行(\\n)は明示的に別の行として扱う", () => {
    const ctx = makeFakeCtx(10);
    const lines = wrapTextAtReferenceScale(ctx, "a\nb", 24);
    expect(lines).toEqual(["a", "b"]);
  });

  it("空文字は1つの空行として扱う（クラッシュしない）", () => {
    const ctx = makeFakeCtx(10);
    expect(wrapTextAtReferenceScale(ctx, "", 24)).toEqual([""]);
  });
});

describe("normalizedBoxSize", () => {
  it("幅は基準半径に対するREFERENCE_TEXT_BOX_WIDTH_PXの比率になる", () => {
    const { width } = normalizedBoxSize(24, 1);
    expect(width).toBeCloseTo(REFERENCE_TEXT_BOX_WIDTH_PX / REFERENCE_RADIUS);
  });

  it("行数が増えると高さも比例して増える", () => {
    const one = normalizedBoxSize(24, 1);
    const three = normalizedBoxSize(24, 3);
    expect(three.height).toBeCloseTo(one.height * 3);
  });
});
