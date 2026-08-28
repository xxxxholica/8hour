import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function run(width, height, label) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
  await page.waitForSelector("canvas.circle-canvas");

  const canvasBox = await page.locator("canvas.circle-canvas").boundingBox();
  console.log(`[${label}] canvas size:`, canvasBox.width, canvasBox.height);

  // draw something so archive preview has content to render
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(cx - canvasBox.width * 0.2, cy);
  await page.mouse.down();
  await page.mouse.move(cx + canvasBox.width * 0.2, cy);
  await page.mouse.up();
  await page.waitForTimeout(150);

  await page.getByRole("button", { name: "振り返り" }).click();
  await page.waitForTimeout(250);

  const previewBox = await page.locator("canvas.archive-preview").boundingBox();
  console.log(`[${label}] archive preview size:`, previewBox.width, previewBox.height);
  console.log(`[${label}] size match:`, Math.abs(previewBox.width - canvasBox.width) < 2);

  const toolbarVisible = await page.locator(".toolbar").isVisible();
  const seekbarVisible = await page.locator(".seekbar").isVisible();
  console.log(`[${label}] toolbar visible in archive:`, toolbarVisible, "seekbar visible:", seekbarVisible);

  await page.screenshot({ path: `/tmp/archive-${label}.png` });

  // back to canvas view — toolbar should reappear, seekbar should hide
  await page.getByRole("button", { name: "キャンバス" }).click();
  await page.waitForTimeout(150);
  const toolbarVisible2 = await page.locator(".toolbar").isVisible();
  const seekbarVisible2 = await page.locator(".seekbar").isVisible();
  console.log(`[${label}] back to canvas — toolbar visible:`, toolbarVisible2, "seekbar visible:", seekbarVisible2);

  console.log(`[${label}] console errors:`, JSON.stringify(errors));
  await page.close();
}

await run(500, 900, "narrow-tall");
await run(1400, 1000, "wide-desktop");

await browser.close();
