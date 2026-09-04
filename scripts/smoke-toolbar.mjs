import { chromium } from "playwright";

const errors = [];
// ブラウザ本体の場所はPlaywrightの既定解決に任せる——PLAYWRIGHT_BROWSERS_PATH
// が設定されていればそこを、未設定ならデフォルトのキャッシュ（`npx playwright
// install`が置く場所）を見る。固定パスを直書きすると、そのパスが存在しない
// 環境（ローカル開発機など）で即座に起動失敗していた。
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 500, height: 820 } });
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("canvas.circle-canvas");
await page.screenshot({ path: "/tmp/t1-toolbar-default.png" });

const box = await page.locator("canvas.circle-canvas").boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

async function drag(x1, y1, x2, y2, steps = 16) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
  }
  await page.mouse.up();
}

// 1. 標準ペン(pen、既定色は黒)で描く
await drag(cx - 80, cy - 60, cx + 20, cy - 60);
await page.waitForTimeout(200);

// 2. マーカーに切り替えて描く（既定色はシアン）
await page.locator('.toolbar-btn[aria-label="マーカー"]').click();
await drag(cx - 80, cy - 20, cx + 20, cy - 20);
await page.waitForTimeout(200);

// 3. ペンに戻し、固定スウォッチから赤を選んでから描く
await page.locator('.toolbar-btn[aria-label="ペン"]').click();
await page.getByRole("button", { name: "インクの色: 赤" }).click();
await drag(cx - 80, cy + 20, cx + 20, cy + 20);
await page.waitForTimeout(200);

await page.screenshot({ path: "/tmp/t2-three-strokes.png" });

let memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT_AFTER_3_TOOLS", memos.length);
console.log("TOOLS", memos.map((m) => m.tool).join(","));
console.log("COLORS", memos.map((m) => m.color).join(","));
console.log("LAST_COLOR_IS_RED", memos[2]?.color === "oklch(52% 0.2 25)");

// 4. 消しゴムに切り替えて、マーカーで描いた線(2本目)を消す
await page.locator('.toolbar-btn[aria-label="消しゴム"]').click();
await drag(cx - 90, cy - 20, cx + 30, cy - 20, 10);
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/t3-after-erase.png" });

memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT_AFTER_ERASE", memos.length);

// 5. 消しゴムのままドラッグしても、新規メモ作成が起きないことを確認
//    (すでに1本消えているので、残りは2本のまま増減しない)
console.log("TOOLS_AFTER_ERASE", memos.map((m) => m.tool).join(","));

console.log("CONSOLE_ERRORS", JSON.stringify(errors));
await browser.close();
