import { chromium } from "playwright";

const errors = [];
// ブラウザ本体の場所はPlaywrightの既定解決に任せる——PLAYWRIGHT_BROWSERS_PATH
// が設定されていればそこを、未設定ならデフォルトのキャッシュ（`npx playwright
// install`が置く場所）を見る。固定パスを直書きすると、そのパスが存在しない
// 環境（ローカル開発機など）で即座に起動失敗していた。
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 500, height: 780 } });
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("canvas.circle-canvas");

// 空状態のスクリーンショット
await page.screenshot({ path: "/tmp/shot-1-empty.png" });

// 円の中でドラッグしてメモを書く
const box = await page.locator("canvas.circle-canvas").boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx - 60, cy - 40);
await page.mouse.down();
for (let i = 0; i <= 20; i++) {
  const t = i / 20;
  await page.mouse.move(cx - 60 + t * 120, cy - 40 + Math.sin(t * Math.PI * 2) * 15);
}
await page.mouse.up();
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/shot-2-drawn.png" });

// localStorage に保存されているか確認
const stored = await page.evaluate(() => localStorage.getItem("memos"));
const parsed = JSON.parse(stored ?? "[]");
console.log("SAVED_MEMOS_COUNT", parsed.length);
console.log("FIRST_MEMO_STROKE_POINTS", parsed[0]?.strokes?.[0]?.length ?? 0);

// リロード後も残っているか確認（自動フェード・自動消滅は無い設計のため、
// 消しゴムで触れない限りメモは残り続けるはず）。
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("canvas.circle-canvas");
await page.waitForTimeout(200);
const storedAfterReload = await page.evaluate(() => localStorage.getItem("memos"));
const parsedAfterReload = JSON.parse(storedAfterReload ?? "[]");
console.log("MEMOS_AFTER_RELOAD_COUNT", parsedAfterReload.length);
console.log("ALL_STILL_ACTIVE", parsedAfterReload.every((m) => m.status === "active"));

console.log("CONSOLE_ERRORS", JSON.stringify(errors));

await browser.close();
