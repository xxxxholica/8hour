import { chromium } from "playwright";

const errors = [];
// ブラウザ本体の場所はPlaywrightの既定解決に任せる——PLAYWRIGHT_BROWSERS_PATH
// が設定されていればそこを、未設定ならデフォルトのキャッシュ（`npx playwright
// install`が置く場所）を見る。固定パスを直書きすると、そのパスが存在しない
// 環境（ローカル開発機など）で即座に起動失敗していた。
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("canvas.circle-canvas");
await page.screenshot({ path: "/tmp/v3-1-empty-paper.png" });

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

// draw a memo
await drag(cx - 80, cy - 40, cx + 40, cy - 40);
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/v3-2-drawn-on-paper.png" });

// check the panel layout is consolidated into one card
const panelBox = await page.locator(".control-panel").boundingBox();
console.log("CONTROL_PANEL_BOX", JSON.stringify(panelBox));

// draw a second memo with the text tool, to check both memo kinds coexist
await page.locator('.toolbar-btn[aria-label="テキスト"]').click();
await page.mouse.click(cx - 20, cy + 60);
await page.keyboard.type("ためしがき");
await page.locator('.toolbar-btn[aria-label="選択"]').click();
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/v3-3-drawn-and-text.png" });

const memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT", memos.length);
console.log("KINDS", memos.map((m) => m.kind).join(","));

console.log("CONSOLE_ERRORS", JSON.stringify(errors));
await browser.close();
