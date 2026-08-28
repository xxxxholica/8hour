import { chromium } from "playwright";

const errors = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
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

// 1. 標準ペン(pen)で描く
await drag(cx - 80, cy - 60, cx + 20, cy - 60);
await page.waitForTimeout(1600); // セッションを閉じる

// 2. 鉛筆に切り替えて描く
await page.locator('.toolbar-btn[aria-label="鉛筆"]').click();
await drag(cx - 80, cy - 20, cx + 20, cy - 20);
await page.waitForTimeout(1600);

// 3. マーカーに切り替えて描く
await page.locator('.toolbar-btn[aria-label="マーカー"]').click();
await drag(cx - 80, cy + 20, cx + 20, cy + 20);
await page.waitForTimeout(1600);

// 4. 色を変更してから描く（赤に）
await page.locator("input.toolbar-color-input").fill("#e0335c");
await drag(cx - 80, cy + 60, cx + 20, cy + 60);
await page.waitForTimeout(200);

await page.screenshot({ path: "/tmp/t2-four-strokes.png" });

let memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT_AFTER_4_TOOLS", memos.length);
console.log("TOOLS", memos.map((m) => m.tool).join(","));
console.log("COLORS", memos.map((m) => m.color).join(","));
console.log("LAST_COLOR_IS_RED", memos[3]?.color?.toLowerCase() === "#e0335c");

// 5. 消しゴムに切り替えて、鉛筆で描いた線(2本目)を消す
await page.locator('.toolbar-btn[aria-label="消しゴム"]').click();
await drag(cx - 90, cy - 20, cx + 30, cy - 20, 10);
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/t3-after-erase.png" });

memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT_AFTER_ERASE", memos.length);

// 6. 消しゴムのままドラッグしても、なぞり復活や新規メモ作成が起きないことを確認
//    (すでに1本消えているので、残りは3本のまま増減しない)
console.log("TOOLS_AFTER_ERASE", memos.map((m) => m.tool).join(","));

console.log("CONSOLE_ERRORS", JSON.stringify(errors));
await browser.close();
