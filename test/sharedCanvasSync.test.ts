import { afterEach, describe, expect, it, vi } from "vitest";
import type { Memo } from "../src/types";

vi.mock("../src/sharedCanvas", () => ({
  getSharedCanvas: vi.fn(),
  upsertSharedMemo: vi.fn(),
  deleteSharedMemo: vi.fn(),
}));

import { getSharedCanvas, upsertSharedMemo } from "../src/sharedCanvas";
import { SharedRoomSync } from "../src/sharedCanvasSync";

const FAKE_MEMO: Memo = {
  id: "memo-1",
  kind: "stroke",
  x: 0,
  y: 0,
  strokes: [[{ x: 0, y: 0 }]],
  createdAt: 0,
  lastTracedAt: 0,
  traceHistory: [0],
  lifespanDays: null,
  status: "active",
  color: "#000",
  tool: "pen",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("SharedRoomSync poll()の多重実行防止", () => {
  it("前回のGETが解決する前にpollNow()を連続で呼んでも、GETは1回しか飛ばない", async () => {
    let resolveFetch: (detail: { id: string; memos: Memo[] }) => void = () => {};
    const pending = new Promise<{ id: string; memos: Memo[] }>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(getSharedCanvas).mockReturnValue(pending);

    const onRemoteChange = vi.fn();
    const sync = new SharedRoomSync("room-1", onRemoteChange, vi.fn());

    sync.pollNow();
    sync.pollNow();
    sync.pollNow();

    expect(getSharedCanvas).toHaveBeenCalledTimes(1);

    resolveFetch({ id: "room-1", memos: [] });
    await pending;
    // finallyでpollInFlightが下りるまで1マイクロタスク待つ
    await Promise.resolve();

    // 解決後にもう一度呼べば、次のGETは飛ばせる
    vi.mocked(getSharedCanvas).mockResolvedValueOnce({ id: "room-1", memos: [] });
    sync.pollNow();
    await Promise.resolve();
    expect(getSharedCanvas).toHaveBeenCalledTimes(2);
  });

  it("ローカルの変更が保留中（push待ち）の間は、pollNow()を呼んでもGETを飛ばさない", async () => {
    vi.useFakeTimers();
    vi.mocked(getSharedCanvas).mockResolvedValue({ id: "room-1", memos: [] });
    vi.mocked(upsertSharedMemo).mockResolvedValue(undefined);
    const sync = new SharedRoomSync("room-1", vi.fn(), vi.fn());

    sync.pushOp({ upserts: [FAKE_MEMO], deletes: [] }); // pushTimerがセットされ、hasPendingLocalChanges()がtrueになる
    sync.pollNow();
    await Promise.resolve();

    expect(getSharedCanvas).not.toHaveBeenCalled();

    // 後始末: デバウンス分だけ時間を進めてpush自体は完了させておく
    await vi.runAllTimersAsync();
  });
});
