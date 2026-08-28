import { chromium } from "playwright";

const errors = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
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

// draw a period-pen memo (short test duration)
await page.getByText("1分", { exact: true }).click();
await drag(cx - 80, cy + 40, cx + 40, cy + 40);
await page.waitForTimeout(200);

// force it to have been created a while ago + revived once, to exercise the timeline
let memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT", memos.length);
console.log("TRACE_HISTORY_0", JSON.stringify(memos[0].traceHistory));
console.log("TRACE_HISTORY_1", JSON.stringify(memos[1].traceHistory));

// push memo[0] back in time (well beyond the 3-day seekbar lookback cap) and revive it
// once historically, to give the timeline something interesting
await page.evaluate(() => {
  const memos = JSON.parse(localStorage.getItem("memos"));
  const now = Date.now();
  const createdAt = now - 6 * 24 * 60 * 60 * 1000; // 6 days ago (older than the 3-day cap)
  const revivedAt = now - 2 * 24 * 60 * 60 * 1000; // revived 2 days ago
  memos[0].createdAt = createdAt;
  memos[0].traceHistory = [createdAt, revivedAt];
  memos[0].lastTracedAt = revivedAt;
  localStorage.setItem("memos", JSON.stringify(memos));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(200);

// go to archive/reflection view
await page.getByRole("button", { name: "振り返り" }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/v3-3-archive-now.png" });

const sliderMin = await page.locator(".seekbar-slider").getAttribute("min");
const sliderMax = await page.locator(".seekbar-slider").getAttribute("max");
console.log("SLIDER_MIN", sliderMin, "SLIDER_MAX", sliderMax);

// memo[0] was pushed back 6 days, but the seekbar must not let you scrub past
// the 3-day lookback cap (search性を意図的に下げるための制約)
const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
const cappedLowerBound = Date.now() - threeDaysMs;
console.log("SLIDER_MIN_CAPPED_TO_3_DAYS", Math.abs(Number(sliderMin) - cappedLowerBound) < 10000);

// scrub to the very beginning
await page.locator(".seekbar-slider").evaluate((el, min) => {
  el.value = min;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, sliderMin);
await page.waitForTimeout(150);
await page.screenshot({ path: "/tmp/v3-4-archive-scrubbed-start.png" });

const timestampAtStart = await page.locator(".seekbar-timestamp").textContent();
console.log("TIMESTAMP_AT_START", timestampAtStart);
// 絶対日時ではなく相対表現（例: 「3日前」）だけを見せる。検索性を下げるための仕様
console.log("TIMESTAMP_IS_RELATIVE_NOT_ABSOLUTE", /^\d+日前$/.test(timestampAtStart));

// scrub to the middle (should show memo0 revived + faded, memo1 still fresh depending on time)
const mid = Math.round((Number(sliderMin) + Number(sliderMax)) / 2);
await page.locator(".seekbar-slider").evaluate((el, v) => {
  el.value = String(v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, mid);
await page.waitForTimeout(150);
await page.screenshot({ path: "/tmp/v3-5-archive-scrubbed-mid.png" });

// check reset button is now icon-only with aria-label
const resetLabel = await page.locator("#reset-btn").getAttribute("aria-label");
console.log("RESET_ARIA_LABEL", resetLabel);
await page.locator("#reset-btn").click();
const confirmVisible = await page.locator("#reset-confirm").isVisible();
console.log("RESET_CONFIRM_VISIBLE", confirmVisible);
await page.locator("#reset-no").click();

console.log("CONSOLE_ERRORS", JSON.stringify(errors));
await browser.close();
