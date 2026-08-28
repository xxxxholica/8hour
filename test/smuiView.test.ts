// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/sharedCanvas", () => ({
  getSharedCanvas: vi.fn(),
  updateSharedAppearance: vi.fn(),
  addMemoHeat: vi.fn(),
  advanceSession: vi.fn(),
  endSession: vi.fn(),
  extendSession: vi.fn(),
  startSession: vi.fn(),
  resumeSession: vi.fn(),
}));

vi.mock("../src/canvasView", () => {
  class CircularCanvas {
    constructor(..._args: unknown[]) {}
    setLocked = vi.fn();
    setVoteOnly = vi.fn();
    setLensSplit = vi.fn();
    setLensSplitConfinesInput = vi.fn();
    setRotationVoteHandler = vi.fn();
    destroy = vi.fn();
    setFrameShape = vi.fn();
    setFramePattern = vi.fn();
    setPair2Appearance = vi.fn();
    frameShapeIdForPair = vi.fn().mockReturnValue("round");
    framePatternIdForPair = vi.fn().mockReturnValue("matte");
    closeWritingSession = vi.fn();
    finishTextEditingIfOpen = vi.fn();
    undo = vi.fn();
    createExportImage = vi.fn();
    getExportText = vi.fn();
    render = vi.fn();
    getHoverMemoId = vi.fn();
    getHoverRemainingMs = vi.fn();
    isZoomed = vi.fn();
    isEditingTextFixedBottom = vi.fn();
  }
  return { CircularCanvas };
});

import { getSharedCanvas } from "../src/sharedCanvas";
import type { SharedCanvasDetail } from "../src/sharedCanvas";
import { SmuiView } from "../src/smuiView";
import type { Toolbar } from "../src/toolbar";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function makeToolbar(): Toolbar {
  return {
    setEnabled: vi.fn(),
    setColorLocked: vi.fn(),
    setOnlyToolEnabled: vi.fn(),
  } as unknown as Toolbar;
}

function makeDetail(overrides: Partial<SharedCanvasDetail> = {}): SharedCanvasDetail {
  return {
    id: "room-1",
    ownerId: "other-user",
    memos: [],
    session: null,
    frameShapeId: "round",
    framePatternId: "matte",
    ...overrides,
  };
}

function makeView(): SmuiView {
  const container = document.createElement("div");
  return new SmuiView(
    container,
    () => ({ tool: "pen", color: "#000", lifespanDays: 1, fontSize: 16, lineWidth: 4, eraserRadius: 12 }),
    "round",
    "matte",
    makeToolbar()
  );
}

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SmuiView.selectRoom()のGET待ち中に届く変更通知 (issue #113)", () => {
  it("初回GETがまだ解決していない間にnotifyRemoteChangeIfCurrent()が届いても、取りこぼさず反映する", async () => {
    let resolveInitialGet: (detail: SharedCanvasDetail) => void = () => {};
    const initialGet = new Promise<SharedCanvasDetail>((resolve) => {
      resolveInitialGet = resolve;
    });
    const updatedDetail = makeDetail({ frameShapeId: "oval", framePatternId: "tortoiseshell" });

    vi.mocked(getSharedCanvas).mockReturnValueOnce(initialGet).mockResolvedValueOnce(updatedDetail);

    const view = makeView();
    const selectPromise = view.selectRoom("room-1");

    // ルームマスターが見た目を変更した通知が、初回GETの完了より先に届いた状況を再現する。
    view.notifyRemoteChangeIfCurrent("room-1");

    resolveInitialGet(makeDetail({ frameShapeId: "round", framePatternId: "matte" }));
    await selectPromise;
    // 取りこぼし分を拾い直す追いGETが解決するのを待つ。
    await Promise.resolve();
    await Promise.resolve();

    expect(view.getAppearanceSync()).toEqual({
      locked: false,
      shapeId: "oval",
      patternId: "tortoiseshell",
      pair2Available: false,
      pair2ShapeId: "round",
      pair2PatternId: "matte",
    });
  });
});
