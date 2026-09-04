import { chromium } from "playwright";

// ブラウザ本体の場所はPlaywrightの既定解決に任せる——PLAYWRIGHT_BROWSERS_PATH
// が設定されていればそこを、未設定ならデフォルトのキャッシュ（`npx playwright
// install`が置く場所）を見る。固定パスを直書きすると、そのパスが存在しない
// 環境（ローカル開発機など）で即座に起動失敗していた。
const browser = await chromium.launch();

const sizes = [
  { name: "mobile", width: 375, height: 700 },
  { name: "tablet", width: 800, height: 900 },
  { name: "wide-short", width: 1600, height: 500 },
  { name: "large-desktop", width: 1400, height: 1100 },
  { name: "ultra-wide", width: 2400, height: 1300 },
];

for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
  await page.waitForSelector("canvas.circle-canvas");
  await page.waitForTimeout(150); // ResizeObserverの反映を待つ

  const canvasBox = await page.locator("canvas.circle-canvas").boundingBox();
  const footerBox = await page.locator(".app-footer").boundingBox();
  const bodyOverflow = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  console.log(
    `${s.name} (${s.width}x${s.height}): canvas=${Math.round(canvasBox.width)}x${Math.round(
      canvasBox.height
    )} footerBottom=${Math.round(footerBox.y + footerBox.height)} viewportH=${s.height} ` +
      `overflowY=${bodyOverflow.scrollHeight > bodyOverflow.clientHeight + 2} overflowX=${
        bodyOverflow.scrollWidth > bodyOverflow.clientWidth + 2
      }`
  );

  await page.screenshot({ path: `/tmp/responsive-${s.name}.png` });
  await page.close();
}

await browser.close();
