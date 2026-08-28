import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 500, height: 780 } });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("canvas.circle-canvas");

const box = await page.locator("canvas.circle-canvas").boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx - 30, cy);
await page.mouse.down();
await page.mouse.move(cx + 30, cy + 20);
await page.mouse.up();
await page.waitForTimeout(100);

let count = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]").length);
console.log("BEFORE_RESET", count);

await page.getByRole("button", { name: "すべて消す" }).click();
const confirmVisible = await page.locator("#reset-confirm").isVisible();
console.log("CONFIRM_SHOWN", confirmVisible);

// いいえ を押すと消えない
await page.getByRole("button", { name: "いいえ" }).click();
count = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]").length);
console.log("AFTER_CANCEL", count);

await page.getByRole("button", { name: "すべて消す" }).click();
await page.getByRole("button", { name: "はい" }).click();
count = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]").length);
console.log("AFTER_CONFIRM", count);

await page.screenshot({ path: "/tmp/shot-6-reset.png" });
await browser.close();
