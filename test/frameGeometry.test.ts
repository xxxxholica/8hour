// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameGeometry } from "../src/frameGeometry";
import { FRAME_SHAPE_ORDER } from "../src/frameShape";

function makeFakeCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  return {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    fillRect: () => {},
    beginPath: () => {},
    ellipse: () => {},
    fill: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    clip: () => {},
  } as unknown as CanvasRenderingContext2D;
}

class FakePath2D {
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  ellipse(): void {}
  closePath(): void {}
  rect(): void {}
  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
  addPath(): void {}
}

function makeContainer(width: number, height: number): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  return el;
}

beforeEach(() => {
  // フレーム柄(framePattern.ts)がべっ甲/木目の柄を組み立てる際に内部で
  // オフスクリーンcanvasを作りgetContext("2d")するため、jsdomにcanvas 2D
  // contextの実装が無い分をここでまとめて差し替える。
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => makeFakeCtx() as unknown as RenderingContext
  );
  // jsdomにはPath2Dの実装が無いため、frameShape.tsのbuildPath()が動くよう
  // 最小限のスタブを補う（このテストではパスの形そのものは検証しない）。
  (globalThis as unknown as { Path2D: unknown }).Path2D = FakePath2D;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeGlassesGeometry(): FrameGeometry {
  const canvas = document.createElement("canvas");
  const ctx = makeFakeCtx();
  const container = makeContainer(400, 2000);
  return new FrameGeometry(canvas, ctx, container, 1, {
    frameShapeId: "round",
    frameStrokeColor: "#000",
    frameStrokeWidth: (canvasSizePx) => canvasSizePx * 0.04,
    frameKind: "glasses",
    framePatternId: "matte",
  });
}

describe("FrameGeometry: 共同アイデア出しの組ごとの形状ローテーション (issue #113③)", () => {
  it("レンズ分割が無効な間は、どの組も設定した形状のままになる", () => {
    const geometry = makeGlassesGeometry();
    expect(geometry.frameShapeIdForPair(0)).toBe("round");
    expect(geometry.framePathForPair(0)).toBe(geometry.framePath);
  });

  it("レンズ分割が有効になると、組ごとにFRAME_SHAPE_ORDERを順送りした異なる形状になる", () => {
    const geometry = makeGlassesGeometry();
    geometry.setLensSplitPairCount(2);

    const baseIndex = FRAME_SHAPE_ORDER.indexOf("round");
    expect(geometry.frameShapeIdForPair(0)).toBe(FRAME_SHAPE_ORDER[baseIndex % FRAME_SHAPE_ORDER.length]);
    expect(geometry.frameShapeIdForPair(1)).toBe(FRAME_SHAPE_ORDER[(baseIndex + 1) % FRAME_SHAPE_ORDER.length]);
    expect(geometry.frameShapeIdForPair(0)).not.toBe(geometry.frameShapeIdForPair(1));

    // 形状そのものが組ごとに異なるため、単一のPath2Dを使い回さず組別に個別のPath2Dを持つ。
    expect(geometry.framePathForPair(0)).not.toBe(geometry.framePathForPair(1));
    expect(geometry.strokePathForPair(0)).not.toBe(geometry.strokePathForPair(1));
  });

  it("レンズ分割を無効に戻すと、組別の形状ローテーションも解除される", () => {
    const geometry = makeGlassesGeometry();
    geometry.setLensSplitPairCount(2);
    geometry.setLensSplitPairCount(null);

    expect(geometry.frameShapeIdForPair(0)).toBe("round");
    expect(geometry.frameShapeIdForPair(1)).toBe("round");
  });
});

describe("FrameGeometry: 「メガネ2」専用の見た目の手動上書き (issue #113④)", () => {
  it("手動上書きが無い間は、メガネ2(pairIndex=1)は自動ローテーション(issue #113③)のままになる", () => {
    const geometry = makeGlassesGeometry();
    geometry.setLensSplitPairCount(2);

    const baseIndex = FRAME_SHAPE_ORDER.indexOf("round");
    expect(geometry.frameShapeIdForPair(1)).toBe(FRAME_SHAPE_ORDER[(baseIndex + 1) % FRAME_SHAPE_ORDER.length]);
    expect(geometry.framePatternIdForPair(1)).toBe("tortoiseshell");
  });

  it("setPair2Appearanceで手動上書きすると、自動ローテーションより優先される", () => {
    const geometry = makeGlassesGeometry();
    geometry.setLensSplitPairCount(2);
    geometry.setPair2Appearance("square", "wood");

    expect(geometry.frameShapeIdForPair(1)).toBe("square");
    expect(geometry.framePatternIdForPair(1)).toBe("wood");
    // メガネ1(pairIndex=0)は上書きの影響を受けない。
    expect(geometry.frameShapeIdForPair(0)).toBe("round");
    expect(geometry.framePatternIdForPair(0)).toBe("matte");
  });

  it("setPair2Appearance(null, null)で上書きを解除すると、自動ローテーションに戻る", () => {
    const geometry = makeGlassesGeometry();
    geometry.setLensSplitPairCount(2);
    geometry.setPair2Appearance("square", "wood");
    geometry.setPair2Appearance(null, null);

    const baseIndex = FRAME_SHAPE_ORDER.indexOf("round");
    expect(geometry.frameShapeIdForPair(1)).toBe(FRAME_SHAPE_ORDER[(baseIndex + 1) % FRAME_SHAPE_ORDER.length]);
    expect(geometry.framePatternIdForPair(1)).toBe("tortoiseshell");
  });
});

describe("FrameGeometry: 共同アイデア出しの参加人数(レンズ分割の組数)と縁取りの太さ (issue #113②)", () => {
  it("組数(pairCount)が増えても、個々のフレームの縁取りの太さ・スケールは初期状態から変わらない", () => {
    const geometry = makeGlassesGeometry();

    const baselineStrokeWidth = geometry.frameStrokeWidthPx;

    // 3人以上の参加(maxParticipants>=3)でcomputeLensSplitPairCountが1→2になる状況を再現する。
    geometry.setLensSplitPairCount(2);
    expect(geometry.frameStrokeWidthPx).toBeCloseTo(baselineStrokeWidth, 5);
  });
});

describe("FrameGeometry: 大画面での共有ビューの回転操作 (ユーザー報告：個人キャンバスと同様に回せるようにすべき)", () => {
  it("組数(pairCount)ぶん並べても画面に十分な余白がある間は、個々のレンズのscale(=回転操作の余地)が組数1のときと変わらない", () => {
    const canvas = document.createElement("canvas");
    const ctx = makeFakeCtx();
    // 横に並べる(row)方向で、2組ぶんの実寸をそのまま並べても収まりきる
    // 超横長の大画面（プロジェクター壁面等）を再現する。
    const container = makeContainer(8000, 3000);
    const geometry = new FrameGeometry(canvas, ctx, container, 1, {
      frameShapeId: "round",
      frameStrokeColor: "#000",
      frameStrokeWidth: (canvasSizePx) => canvasSizePx * 0.04,
      frameKind: "glasses",
      framePatternId: "matte",
    });

    const baselineScale = geometry.scale;

    // 3人以上の参加でcomputeLensSplitPairCountが1→2になる状況を再現する。
    geometry.setLensSplitPairCount(2);

    // 修正前は組数1を基準にした矩形へ組数ぶんの全体を無条件に収めようとして
    // scaleがほぼ半減していたが、実際に画面へ収まりきるなら「組数1だったときの
    // 大きさ」を目標にするため、変わらない。
    expect(geometry.scale).toBe(baselineScale);
  });

  it("画面に組数ぶんの余白が無い場合は、これまでどおり実際に収まるようscaleを縮める（退化なし）", () => {
    const canvas = document.createElement("canvas");
    const ctx = makeFakeCtx();
    // 正方形に近い画面では、2組を横に並べると全体の横幅が大きく伸びるため、
    // 画面がそれなりに大きくても組数ぶんの余白は足りなくなる。
    const container = makeContainer(3000, 3000);
    const geometry = new FrameGeometry(canvas, ctx, container, 1, {
      frameShapeId: "round",
      frameStrokeColor: "#000",
      frameStrokeWidth: (canvasSizePx) => canvasSizePx * 0.04,
      frameKind: "glasses",
      framePatternId: "matte",
    });

    const baselineScale = geometry.scale;
    geometry.setLensSplitPairCount(2);

    expect(geometry.scale).toBeLessThan(baselineScale);
  });
});
