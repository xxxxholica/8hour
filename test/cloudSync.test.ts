import { afterEach, describe, expect, it, vi } from "vitest";
import type { Memo } from "../src/types";

vi.mock("../src/apiClient", () => ({
  authFetch: vi.fn(),
  isSignedIn: vi.fn(() => true),
  _setApiTokenGetter: vi.fn(),
}));

import { authFetch, isSignedIn } from "../src/apiClient";
import { hasPendingLocalChanges, pushOp, refreshFromCloud, setTokenGetter } from "../src/cloudSync";

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

function okResponse(body: unknown = {}) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSignedIn).mockReturnValue(true);
  vi.useRealTimers();
});

describe("cloudSync pushOp（メモ単位のデバウンス送信、issue #99）", () => {
  it("短時間の連続したpushOpは1回のPUTにまとめられる", async () => {
    vi.useFakeTimers();
    vi.mocked(authFetch).mockResolvedValue(okResponse());

    pushOp({ upserts: [FAKE_MEMO], deletes: [] });
    pushOp({ upserts: [{ ...FAKE_MEMO, x: 0.5 }], deletes: [] }); // 同じメモへの2回目は1回にまとまる

    expect(authFetch).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();

    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(authFetch).mock.calls[0][0]).toBe(`/canvas/memos/${FAKE_MEMO.id}`);
    expect(vi.mocked(authFetch).mock.calls[0][1]?.method).toBe("PUT");
  });

  it("deleteが最後に届いたメモは、upsertではなくDELETEとして送られる", async () => {
    vi.useFakeTimers();
    vi.mocked(authFetch).mockResolvedValue(okResponse());

    pushOp({ upserts: [FAKE_MEMO], deletes: [] });
    pushOp({ upserts: [], deletes: [FAKE_MEMO.id] });
    await vi.runAllTimersAsync();

    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(authFetch).mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("未ログイン(isSignedIn=false)の間はpushOpしても何も送らない", async () => {
    vi.useFakeTimers();
    vi.mocked(isSignedIn).mockReturnValue(false);

    pushOp({ upserts: [FAKE_MEMO], deletes: [] });
    await vi.runAllTimersAsync();

    expect(authFetch).not.toHaveBeenCalled();
  });

  it("setTokenGetter(null)は保留中のpushをすべて破棄する", async () => {
    vi.useFakeTimers();
    pushOp({ upserts: [FAKE_MEMO], deletes: [] });
    expect(hasPendingLocalChanges()).toBe(true);

    setTokenGetter(null);
    expect(hasPendingLocalChanges()).toBe(false);

    await vi.runAllTimersAsync();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("送信待ち/送信中の間は、refreshFromCloudがGETをスキップする", async () => {
    vi.useFakeTimers();
    vi.mocked(authFetch).mockResolvedValue(okResponse());
    pushOp({ upserts: [FAKE_MEMO], deletes: [] });

    const store = { getAll: () => [], replaceAll: vi.fn(), applyRemoteUpsert: vi.fn(), applyRemoteDelete: vi.fn() };
    await refreshFromCloud(store);

    expect(authFetch).not.toHaveBeenCalledWith("/canvas");
    await vi.runAllTimersAsync();
  });
});
