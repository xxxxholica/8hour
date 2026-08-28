import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectRealtimeSync,
  FLAP_COOLDOWN_MS,
  FLAP_THRESHOLD,
  RECONNECT_BASE_MS,
} from "../src/realtimeSync";

type Listener = (ev: unknown) => void;

/** ブラウザのWebSocketの、このモジュールが使う範囲だけを再現した最小限のモック。 */
class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  private listeners = new Map<string, Listener[]>();

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  send(): void {}

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  private emit(type: string, ev: unknown = {}): void {
    for (const cb of this.listeners.get(type) ?? []) cb(ev);
  }

  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  triggerClose(code = 1006, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code, reason });
  }
}

function fakeSession() {
  return { getToken: async () => "test-token" };
}

function fakeCallbacks(overrides: Partial<Parameters<typeof connectRealtimeSync>[1]> = {}) {
  return {
    onPersonalMemoUpserted: vi.fn(),
    onPersonalMemoDeleted: vi.fn(),
    onSharedChanged: vi.fn(),
    onSessionChanged: vi.fn(),
    onHeatChanged: vi.fn(),
    onMemoUpserted: vi.fn(),
    onMemoDeleted: vi.fn(),
    onReconnected: vi.fn(),
    ...overrides,
  };
}

/** 現在保留中のWebSocket接続を、開いてすぐ切断する（フラッピングの1サイクル）。 */
async function connectThenImmediatelyDisconnect(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  ws.triggerOpen();
  ws.triggerClose();
}

describe("connectRealtimeSyncのサーキットブレーカー", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
  });

  it("短時間に接続が何度も切れると、通常のバックオフを超えて長時間再接続を止める", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);

    const handle = connectRealtimeSync(fakeSession(), fakeCallbacks());

    // FLAP_THRESHOLD回、接続してはすぐ切れる、を繰り返す
    // （openのたびにreconnectDelayが基準値にリセットされるため、
    //  通常のバックオフは短い間隔のまま——だからこそサーキットブレーカーが要る）。
    // FLAP_WINDOW_MS(30秒)以内に収まるよう、基準バックオフ分だけ進める
    // （最後の1回の直後はクールダウン計測のため進めない）。
    for (let i = 0; i < FLAP_THRESHOLD; i++) {
      await connectThenImmediatelyDisconnect();
      if (i < FLAP_THRESHOLD - 1) {
        await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS + 100);
      }
    }

    const countAtThreshold = MockWebSocket.instances.length;

    // クールダウン時間の直前まで進めても、まだ再接続していないはず
    await vi.advanceTimersByTimeAsync(FLAP_COOLDOWN_MS - 1000);
    expect(MockWebSocket.instances.length).toBe(countAtThreshold);

    // クールダウンを過ぎたら再接続を試みる
    await vi.advanceTimersByTimeAsync(2000);
    expect(MockWebSocket.instances.length).toBe(countAtThreshold + 1);

    handle.disconnect();
  });

  it("正常に接続が続いている間は再接続しない", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);

    const handle = connectRealtimeSync(fakeSession(), fakeCallbacks());
    await vi.advanceTimersByTimeAsync(0);
    const ws = MockWebSocket.instances[0];
    ws.triggerOpen();

    await vi.advanceTimersByTimeAsync(FLAP_COOLDOWN_MS);
    expect(MockWebSocket.instances.length).toBe(1);

    handle.disconnect();
  });

  it("onReconnectedは初回接続では呼ばれず、再接続の時だけ呼ばれる", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
    const onReconnected = vi.fn();

    const handle = connectRealtimeSync(fakeSession(), fakeCallbacks({ onReconnected }));
    await vi.advanceTimersByTimeAsync(0);
    MockWebSocket.instances[0].triggerOpen();
    expect(onReconnected).not.toHaveBeenCalled();

    MockWebSocket.instances[0].triggerClose();
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS + 100);
    MockWebSocket.instances[MockWebSocket.instances.length - 1].triggerOpen();
    expect(onReconnected).toHaveBeenCalledTimes(1);

    handle.disconnect();
  });
});
