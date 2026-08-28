import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimGuestInvite,
  clearGuestSession,
  loadGuestSession,
  saveGuestSession,
} from "../src/guestSession";

// storage.test.ts/memoStore.test.tsと同じ、node環境向けの最小限のlocalStorageモック。
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("guestSession（招待リンク経由のゲスト参加、issue #79）", () => {
  it("保存したセッションをcanvasIdで読み戻せる", () => {
    saveGuestSession({ canvasId: "room-1", token: "gst_abc", expiresAt: Date.now() + 10_000 });
    const loaded = loadGuestSession("room-1");
    expect(loaded).toEqual({ canvasId: "room-1", token: "gst_abc", expiresAt: expect.any(Number) });
  });

  it("期限切れのセッションはnullを返し、保存領域からも削除される", () => {
    saveGuestSession({ canvasId: "room-1", token: "gst_abc", expiresAt: Date.now() - 1000 });
    expect(loadGuestSession("room-1")).toBeNull();
    expect(localStorage.getItem("guestSession:room-1")).toBeNull();
  });

  it("保存されていないcanvasIdはnullを返す", () => {
    expect(loadGuestSession("no-such-room")).toBeNull();
  });

  it("clearGuestSessionで明示的に削除できる", () => {
    saveGuestSession({ canvasId: "room-1", token: "gst_abc", expiresAt: Date.now() + 10_000 });
    clearGuestSession("room-1");
    expect(loadGuestSession("room-1")).toBeNull();
  });

  it("claimGuestInviteは成功時にStoredGuestSessionを返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ guestId: "g1", token: "gst_xyz", expiresAt: 12345 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = await claimGuestInvite("room-1", "inv_token");

    expect(session).toEqual({ canvasId: "room-1", token: "gst_xyz", expiresAt: 12345 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/shared-canvases/room-1/guest-session");
    expect(JSON.parse(init.body)).toEqual({ inviteToken: "inv_token" });
  });

  it("claimGuestInviteは失敗時にサーバーのエラーメッセージで例外を投げる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "招待リンクが無効か期限切れです" }),
      })
    );

    await expect(claimGuestInvite("room-1", "inv_bad")).rejects.toThrow("招待リンクが無効か期限切れです");
  });
});
