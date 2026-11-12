import { describe, expect, it } from "vitest";
import {
  FONT_SIZE_STEPS,
  MIN_FONT_PX,
  REFERENCE_TEXT_BOX_WIDTH_PX,
  clampLineLeft,
  clampRowTop,
  fontPxForRender,
  groupRowsByParagraph,
  layoutText,
  lineRowPitch,
  minLineWrapWidthPx,
  normalizedBoxSize,
  snapToRowTop,
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

describe("layoutText（紙の幅いっぱいまでは折り返さない）", () => {
  it("以前の上限(480px)を超える長さの1行でも、上限幅の範囲内なら折り返さない", () => {
    const ctx = makeFakeCtx(10);
    const text = "a".repeat(60); // 600px
    const { lines, contentWidthPx } = layoutText(ctx, text, 24, 800);
    expect(lines).toEqual([text]);
    expect(contentWidthPx).toBe(600);
  });

  it("上限幅を超える行だけを折り返し、折り返し後の最長行の幅を返す", () => {
    const ctx = makeFakeCtx(10);
    const { lines, contentWidthPx } = layoutText(ctx, "a".repeat(25) + "\nb", 24, 100);
    expect(lines).toEqual(["a".repeat(10), "a".repeat(10), "a".repeat(5), "b"]);
    expect(contentWidthPx).toBe(100);
  });

  it("空文字は1つの空行になる", () => {
    expect(layoutText(makeFakeCtx(10), "", 24, 100)).toEqual({ lines: [""], contentWidthPx: 0 });
  });
});

describe("行モードの行グリッド", () => {
  const pitch = lineRowPitch(24); // 24 * 1.4 / 340

  it("1行の高さは、フォントサイズ×行間倍率を基準半径で割った値", () => {
    expect(pitch).toBeCloseTo((24 * 1.4) / REFERENCE_RADIUS);
    expect(lineRowPitch(24, 1.2)).toBeCloseTo((24 * 1.2) / REFERENCE_RADIUS);
  });

  it("snapToRowTopはタップ位置を含む行の上端（pitchの整数倍）へ揃える", () => {
    expect(snapToRowTop(0.01, pitch)).toBeCloseTo(0);
    expect(snapToRowTop(pitch * 2.9, pitch)).toBeCloseTo(pitch * 2);
    expect(snapToRowTop(-0.01, pitch)).toBeCloseTo(-pitch);
    expect(snapToRowTop(-pitch * 3, pitch)).toBeCloseTo(-pitch * 3);
  });

  it("clampRowTopは収まっているブロックを動かさない", () => {
    expect(clampRowTop(0.123, 0.2, pitch, -0.6, 0.6)).toBe(0.123);
  });

  it("clampRowTopははみ出すブロックを、行グリッド上の位置へ寄せる", () => {
    const bottom = clampRowTop(0.5, 0.3, pitch, -0.6, 0.6); // 下端が0.8で0.6を超える
    expect(bottom + 0.3).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(bottom / pitch).toBeCloseTo(Math.round(bottom / pitch));
    const top = clampRowTop(-0.9, 0.3, pitch, -0.6, 0.6); // 上端が-0.6を超える
    expect(top).toBeGreaterThanOrEqual(-0.6 - 1e-9);
    expect(top / pitch).toBeCloseTo(Math.round(top / pitch));
  });

  it("clampRowTopは上下が非対称な領域にも使える", () => {
    const top = clampRowTop(-1, 0.1, pitch, -0.3, 0.5);
    expect(top).toBeGreaterThanOrEqual(-0.3 - 1e-9);
    expect(clampRowTop(0.45, 0.1, pitch, -0.3, 0.5) + 0.1).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("clampRowTopは領域より高いブロックを上端に揃える", () => {
    expect(clampRowTop(0, 2, pitch, -0.6, 0.6)).toBe(-0.6);
  });

  it("clampLineLeftは最低限の折り返し幅が右端まで残るよう左端を寄せる", () => {
    const minWrap = minLineWrapWidthPx(24) / REFERENCE_RADIUS;
    expect(clampLineLeft(0.2, -0.9, 0.9, 24)).toBe(0.2);
    expect(clampLineLeft(0.89, -0.9, 0.9, 24)).toBeCloseTo(0.9 - minWrap);
    expect(clampLineLeft(-5, -0.9, 0.9, 24)).toBe(-0.9);
  });
});

describe("groupRowsByParagraph（折り返した行を段落ごとにまとめる）", () => {
  it("折り返しの無い文章は、1段落1行ずつ", () => {
    expect(groupRowsByParagraph("あ\nい", ["あ", "い"])).toEqual([["あ"], ["い"]]);
  });

  it("折り返された段落は、複数の行をまとめる", () => {
    expect(groupRowsByParagraph("abcde\nfg", ["abc", "de", "fg"])).toEqual([["abc", "de"], ["fg"]]);
  });

  it("空の段落は、空の1行として扱う", () => {
    expect(groupRowsByParagraph("a\n\nb", ["a", "", "b"])).toEqual([["a"], [""], ["b"]]);
  });

  it("行が文章と食い違うデータ（過不足・内容違い）はnull", () => {
    expect(groupRowsByParagraph("abc", ["ab"])).toBeNull();
    expect(groupRowsByParagraph("abc", ["abc", "x"])).toBeNull();
    expect(groupRowsByParagraph("abc", ["abd"])).toBeNull();
    expect(groupRowsByParagraph("a\nb", ["a", "", "b"])).toBeNull();
  });

  it("layoutTextの折り返し結果とは必ず整合する", () => {
    const ctx = makeFakeCtx(10);
    const text = "a".repeat(25) + "\n\n" + "b".repeat(7);
    const { lines } = layoutText(ctx, text, 24, 100);
    const groups = groupRowsByParagraph(text, lines);
    expect(groups?.map((g) => g.length)).toEqual([3, 1, 1]);
  });
});
