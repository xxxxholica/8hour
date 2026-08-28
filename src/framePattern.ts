import { ICONS } from "./icons";

/**
 * フレームの柄・質感。frameShape.tsが枠の輪郭（形）を決めるのに対し、
 * こちらは枠の塗り（ctx.strokeStyle/fillStyleに使える値）を決める
 * ——役割を分けている。共有キャンバス（frameKind:"glasses"）・個人キャンバス
 * （frameKind:"single"）のどちらでも使う（frameGeometry.ts参照）。
 */

export type FramePatternId = "matte" | "tortoiseshell" | "clear" | "wood";
export const DEFAULT_FRAME_PATTERN_ID: FramePatternId = "matte";
export const FRAME_PATTERN_ORDER: FramePatternId[] = ["matte", "tortoiseshell", "clear", "wood"];

interface FramePattern {
  id: FramePatternId;
  label: string;
  /** ctx.strokeStyle/fillStyleにそのまま使える値を作る。reachPxは枠が実際に
   *  描かれる横幅の目安（原点から左右レンズの外側先端までのpx距離）——
   *  グラデーション系の柄はこれを使ってサイズを決める。タイル柄（べっ甲・木目）
   *  はreachPxに依存しない（原寸のタイルを繰り返すだけ）。 */
  buildStyle(ctx: CanvasRenderingContext2D, reachPx: number): CanvasPattern | CanvasGradient | string;
}

const matte: FramePattern = {
  id: "matte",
  label: "マット",
  buildStyle(ctx, reachPx) {
    const g = ctx.createLinearGradient(-reachPx, 0, reachPx, 0);
    g.addColorStop(0, "oklch(25% 0.02 55)");
    g.addColorStop(0.45, "oklch(34% 0.022 55)");
    g.addColorStop(0.55, "oklch(34% 0.022 55)");
    g.addColorStop(1, "oklch(25% 0.02 55)");
    return g;
  },
};

const clear: FramePattern = {
  id: "clear",
  label: "クリア",
  buildStyle(ctx, reachPx) {
    const g = ctx.createLinearGradient(-reachPx, -reachPx * 0.25, reachPx, reachPx * 0.25);
    g.addColorStop(0, "oklch(80% 0.03 90 / 0.5)");
    g.addColorStop(0.35, "oklch(97% 0.015 95 / 0.8)");
    g.addColorStop(0.5, "oklch(72% 0.035 90 / 0.45)");
    g.addColorStop(0.7, "oklch(97% 0.015 95 / 0.8)");
    g.addColorStop(1, "oklch(80% 0.03 90 / 0.5)");
    return g;
  },
};

/** タイル系の柄（べっ甲・木目）は原寸pxのオフスクリーンcanvasに一度だけ描いて
 *  使い回す——毎フレーム再生成しない。サイズ非依存（画面のズームに関わらず
 *  一定の「粒の大きさ」に見える、実物の素材と同じ考え方）。 */
const TILE_SIZE = 48;

function buildTortoiseshellTile(): HTMLCanvasElement {
  const tile = document.createElement("canvas");
  tile.width = TILE_SIZE;
  tile.height = TILE_SIZE;
  const tctx = tile.getContext("2d")!;
  tctx.fillStyle = "oklch(46% 0.09 70)";
  tctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  const blotches = [
    { x: 10, y: 8, r: 9, color: "oklch(20% 0.03 50)", alpha: 0.55 },
    { x: 34, y: 14, r: 7, color: "oklch(28% 0.07 40)", alpha: 0.6 },
    { x: 6, y: 32, r: 8, color: "oklch(30% 0.08 45)", alpha: 0.5 },
    { x: 28, y: 36, r: 10, color: "oklch(18% 0.02 40)", alpha: 0.6 },
    { x: 42, y: 42, r: 6, color: "oklch(62% 0.1 80)", alpha: 0.35 },
  ];

  // 継ぎ目が目立たないよう、タイルの周囲8方向にずらしたコピーも重ねて描く
  // （斑がタイルの端をまたいでいても、隣のタイルに正しく続いて見える）。
  for (const dx of [-TILE_SIZE, 0, TILE_SIZE]) {
    for (const dy of [-TILE_SIZE, 0, TILE_SIZE]) {
      for (const b of blotches) {
        tctx.globalAlpha = b.alpha;
        tctx.fillStyle = b.color;
        tctx.beginPath();
        tctx.ellipse(b.x + dx, b.y + dy, b.r, b.r * 0.75, 0.4, 0, Math.PI * 2);
        tctx.fill();
      }
    }
  }
  tctx.globalAlpha = 1;
  return tile;
}

function buildWoodTile(): HTMLCanvasElement {
  const tile = document.createElement("canvas");
  tile.width = TILE_SIZE;
  tile.height = TILE_SIZE;
  const tctx = tile.getContext("2d")!;
  tctx.fillStyle = "oklch(53% 0.07 60)";
  tctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  const grainLines = [
    { y: 6, amp: 2.5, color: "oklch(32% 0.06 50)", alpha: 0.5, width: 1.4 },
    { y: 16, amp: 3, color: "oklch(38% 0.07 55)", alpha: 0.45, width: 1.8 },
    { y: 26, amp: 2, color: "oklch(30% 0.05 45)", alpha: 0.55, width: 1.2 },
    { y: 36, amp: 3.5, color: "oklch(36% 0.06 55)", alpha: 0.4, width: 2 },
    { y: 44, amp: 2, color: "oklch(28% 0.05 45)", alpha: 0.5, width: 1.4 },
  ];
  for (const line of grainLines) {
    tctx.strokeStyle = line.color;
    tctx.globalAlpha = line.alpha;
    tctx.lineWidth = line.width;
    tctx.beginPath();
    // タイル1枚の幅にちょうど2周期分の正弦波にして、左右の継ぎ目を揃える。
    for (let x = 0; x <= TILE_SIZE; x++) {
      const y = line.y + Math.sin((x / TILE_SIZE) * Math.PI * 4) * line.amp;
      if (x === 0) tctx.moveTo(x, y);
      else tctx.lineTo(x, y);
    }
    tctx.stroke();
  }
  tctx.globalAlpha = 1;
  return tile;
}

let tortoiseshellTile: HTMLCanvasElement | null = null;
let woodTile: HTMLCanvasElement | null = null;

const tortoiseshell: FramePattern = {
  id: "tortoiseshell",
  label: "べっ甲",
  buildStyle(ctx) {
    tortoiseshellTile ??= buildTortoiseshellTile();
    return ctx.createPattern(tortoiseshellTile, "repeat") ?? "oklch(30% 0.05 55)";
  },
};

const wood: FramePattern = {
  id: "wood",
  label: "木目",
  buildStyle(ctx) {
    woodTile ??= buildWoodTile();
    return ctx.createPattern(woodTile, "repeat") ?? "oklch(40% 0.05 60)";
  },
};

const FRAME_PATTERNS: Record<FramePatternId, FramePattern> = { matte, tortoiseshell, clear, wood };

export function getFramePattern(id: FramePatternId): FramePattern {
  return FRAME_PATTERNS[id];
}

const PATTERN_ICON: Record<FramePatternId, string> = {
  matte: ICONS.patternMatte,
  tortoiseshell: ICONS.patternTortoiseshell,
  clear: ICONS.patternClear,
  wood: ICONS.patternWood,
};

/**
 * 「フレームの色」区画（ボタン列+選択状態の同期）を組み立てる共通ヘルパー。
 * AppearanceSelector（共有キャンバス、ロック・リモート同期あり）と、main.tsが
 * 個人キャンバス用に直接呼ぶ側（ロック・同期なし）の両方が、設定メニュー
 * （SettingsMenu、issue #154）の「見た目の設定」区画に埋め込んで使う——
 * ボタン生成・選択状態の同期ロジックの重複を避けるため。
 */
export function buildFramePatternPicker(
  initialId: FramePatternId,
  onSelect: (id: FramePatternId) => void
): { element: HTMLElement; setValue: (id: FramePatternId) => void; setDisabled: (disabled: boolean) => void } {
  let currentId = initialId;
  const buttons = new Map<FramePatternId, HTMLButtonElement>();

  const section = document.createElement("div");
  section.className = "shared-menu-section";
  const label = document.createElement("div");
  label.className = "shared-section-label";
  label.textContent = "フレームの色";
  section.appendChild(label);

  const row = document.createElement("div");
  row.className = "toolbar-pill";
  for (const id of FRAME_PATTERN_ORDER) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toolbar-btn";
    btn.setAttribute("aria-label", getFramePattern(id).label);
    btn.innerHTML = PATTERN_ICON[id];
    btn.addEventListener("click", () => {
      if (id === currentId) return;
      currentId = id;
      sync();
      onSelect(id);
    });
    buttons.set(id, btn);
    row.appendChild(btn);
  }
  section.appendChild(row);

  function sync(): void {
    for (const [id, btn] of buttons) {
      const active = id === currentId;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }
  sync();

  return {
    element: section,
    setValue(id: FramePatternId) {
      if (id === currentId) return;
      currentId = id;
      sync();
    },
    setDisabled(disabled: boolean) {
      for (const [, btn] of buttons) btn.disabled = disabled;
    },
  };
}
