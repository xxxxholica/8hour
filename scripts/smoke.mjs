import { chromium } from "playwright";

const errors = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
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

// 消えるまでの期間を「1分」(テスト用の短い期間指定)に切り替える
await page.getByText("1分", { exact: true }).click();
await page.mouse.move(cx + 40, cy + 60);
await page.mouse.down();
await page.mouse.move(cx + 70, cy + 90);
await page.mouse.move(cx + 90, cy + 60);
await page.mouse.up();
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/shot-3-period-pen.png" });

const stored2 = await page.evaluate(() => localStorage.getItem("memos"));
const parsed2 = JSON.parse(stored2 ?? "[]");
console.log("AFTER_PERIOD_PEN_COUNT", parsed2.length);
console.log("SECOND_MEMO_LIFESPAN_DAYS", parsed2[1]?.lifespanDays);

// なぞって復活: 経過時間を強制的に進めて再読み込み後の見た目を確認するため、
// lastTracedAt を過去にずらしてリロード → 薄くなっているはずの場所をなぞる
await page.evaluate(() => {
  const memos = JSON.parse(localStorage.getItem("memos"));
  const now = Date.now();
  memos[0].lastTracedAt = now - 3 * 24 * 60 * 60 * 1000; // 3日前 → 20%想定
  localStorage.setItem("memos", JSON.stringify(memos));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("canvas.circle-canvas");
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/shot-4-faded.png" });

// 薄れたメモの上をなぞって復活させる（ストロークの中点＝正確に線上の点を狙う）
const tracePx = { x: cx, y: cy - 40 };
await page.mouse.move(tracePx.x, tracePx.y);
await page.mouse.down();
await page.mouse.move(tracePx.x + 5, tracePx.y + 2);
await page.mouse.up();
await page.waitForTimeout(200);

const stored3 = await page.evaluate(() => localStorage.getItem("memos"));
const parsed3 = JSON.parse(stored3 ?? "[]");
console.log("REVIVED_LAST_TRACED_RECENT", Date.now() - parsed3[0].lastTracedAt < 5000);

// 7日以上経過させて振り返りビューに移動するか確認
await page.evaluate(() => {
  const memos = JSON.parse(localStorage.getItem("memos"));
  memos.forEach((m) => {
    m.lastTracedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
  });
  localStorage.setItem("memos", JSON.stringify(memos));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(300); // rAFループでtickが走るのを待つ
await page.getByRole("button", { name: "振り返り" }).click();
await page.waitForTimeout(100);
await page.screenshot({ path: "/tmp/shot-5-archive.png" });

// 消えたメモの個別一覧はコンセプト上持たせていないため、DOM上の一覧要素ではなく
// localStorageのstatusで消滅済み件数を確認する
const storedFaded = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
const fadedCount = storedFaded.filter((m) => m.status === "faded").length;
console.log("FADED_MEMO_COUNT", fadedCount);
console.log("ARCHIVE_LIST_UI_REMOVED", (await page.locator(".archive-item").count()) === 0);

const activeAfter = await page.evaluate(() => {
  const memos = JSON.parse(localStorage.getItem("memos"));
  return memos.filter((m) => m.status === "active").length;
});
console.log("ACTIVE_AFTER_FADE", activeAfter);

console.log("CONSOLE_ERRORS", JSON.stringify(errors));

await browser.close();
