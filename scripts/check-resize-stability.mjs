import { chromium } from "playwright";

// ブラウザ本体の場所はPlaywrightの既定解決に任せる——PLAYWRIGHT_BROWSERS_PATH
// が設定されていればそこを、未設定ならデフォルトのキャッシュ（`npx playwright
// install`が置く場所）を見る。固定パスを直書きすると、そのパスが存在しない
// 環境（ローカル開発機など）で即座に起動失敗していた。
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 500, height: 700 } });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("canvas.circle-canvas");

let box = await page.locator("canvas.circle-canvas").boundingBox();
let cx = box.x + box.width / 2;
let cy = box.y + box.height / 2;
console.log("initial canvas size", box.width);

// draw a horizontal line spanning ~40% of the circle's radius, centered
await page.mouse.move(cx - box.width * 0.2, cy);
await page.mouse.down();
await page.mouse.move(cx + box.width * 0.2, cy);
await page.mouse.up();
await page.waitForTimeout(150);

const before = await page.evaluate(() => JSON.parse(localStorage.getItem("memos"))[0]);
const normX0 = before.strokes[0][0].x;
const normX1 = before.strokes[0].at(-1).x;
console.log("normalized stroke x range (should be roughly -0.4..0.4):", normX0, normX1);

// now resize the window much larger — the normalized coordinates should NOT change,
// and the memo should render proportionally larger, not stay pinned at its old pixel size
await page.setViewportSize({ width: 1400, height: 1100 });
await page.waitForTimeout(300);

box = await page.locator("canvas.circle-canvas").boundingBox();
console.log("canvas size after resize", box.width);

const after = await page.evaluate(() => JSON.parse(localStorage.getItem("memos"))[0]);
console.log(
  "normalized coords unchanged by resize:",
  after.strokes[0][0].x === normX0 && after.strokes[0].at(-1).x === normX1
);

await page.screenshot({ path: "/tmp/resize-stability-after.png" });
await browser.close();
