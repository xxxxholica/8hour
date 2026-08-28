import { afterEach, describe, expect, it, vi } from "vitest";
import { _setApiTokenGetter, authFetch, isSignedIn, setGuestAuth } from "../src/apiClient";

afterEach(() => {
  vi.unstubAllGlobals();
  _setApiTokenGetter(null);
  setGuestAuth(null);
});

describe("apiClient authFetch（Clerkログイン・ゲスト参加の両対応、issue #79）", () => {
  it("tokenGetterが無くguestAuthがあれば、ゲストトークンをAuthorizationヘッダーに使う", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    setGuestAuth({ canvasId: "room-1", token: "gst_abc" });

    await authFetch("/shared-canvases/room-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer gst_abc");
  });

  it("tokenGetterが設定されていれば、guestAuthより優先してClerkトークンを使う", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    setGuestAuth({ canvasId: "room-1", token: "gst_abc" });
    _setApiTokenGetter(async () => "clerk-token");

    await authFetch("/shared-canvases/room-1");

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer clerk-token");
  });

  it("tokenGetterもguestAuthも無ければ例外を投げる", async () => {
    await expect(authFetch("/shared-canvases/room-1")).rejects.toThrow("未ログインです");
  });

  it("isSignedInはguestAuthの有無に影響されない(ゲストはClerkサインインではない)", () => {
    setGuestAuth({ canvasId: "room-1", token: "gst_abc" });
    expect(isSignedIn()).toBe(false);
  });
});
