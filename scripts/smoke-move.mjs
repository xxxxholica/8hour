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

// 道具の切り替え（特にテキスト道具は文字サイズのステッパー行が現れる）で操作パネルの
// 高さが変わり、キャンバスのサイズ・中心もResizeObserver経由で変わりうるため、
// 座標は使う直前に毎回測り直す（使い回すと古いレイアウトの位置を掴んでしまう）
async function center() {
  const box = await page.locator("canvas.circle-canvas").boundingBox();
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

// --- 手描きストロークを移動できることの確認 ---

let { cx, cy } = await center();

// ペンで円の中心付近に短い線を引く
await page.mouse.move(cx - 30, cy);
await page.mouse.down();
await page.mouse.move(cx + 30, cy, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(100);

let memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT_AFTER_STROKE", memos.length);
const strokeBefore = JSON.parse(JSON.stringify(memos[0].strokes));

// 移動道具に切り替えて、線の上を掴んでドラッグする
await page.locator('.toolbar-btn[aria-label="移動"]').click();
await page.waitForTimeout(50);
({ cx, cy } = await center());
await page.mouse.move(cx - 30, cy);
await page.mouse.down();
await page.mouse.move(cx - 30 + 60, cy + 40, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);

memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT_AFTER_MOVE", memos.length); // 新規作成されていないこと
const strokeAfter = memos[0].strokes;
const dx0 = strokeAfter[0][0].x - strokeBefore[0][0].x;
const dy0 = strokeAfter[0][0].y - strokeBefore[0][0].y;
console.log("STROKE_MOVED", dx0 > 0.05 && dy0 > 0.02);
console.log(
  "STROKE_SHAPE_PRESERVED",
  Math.abs(strokeAfter[0][1].x - strokeAfter[0][0].x - (strokeBefore[0][1].x - strokeBefore[0][0].x)) < 0.01
);

// 移動道具で何もない場所をドラッグしても新規メモは作られない
await page.mouse.move(cx - 150, cy - 150);
await page.mouse.down();
await page.mouse.move(cx - 100, cy - 100, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(100);
memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MOVE_TOOL_EMPTY_DRAG_CREATES_NOTHING", memos.length === 1);

// --- テキストメモも移動できることの確認 ---

await page.locator('.toolbar-btn[aria-label="テキスト"]').click();
await page.waitForTimeout(50); // 文字サイズのステッパー行が現れてレイアウトが変わるのを待つ
({ cx, cy } = await center());
await page.mouse.click(cx - 100, cy + 100);
await page.waitForTimeout(100);
await page.keyboard.type("移動テスト");
await page.locator("body").click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(150);

memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
const textMemo = memos.find((m) => m.kind === "text");
const textBeforeX = textMemo.x;
const textBeforeY = textMemo.y;
const textBeforeContent = textMemo.text;

await page.locator('.toolbar-btn[aria-label="移動"]').click();
await page.waitForTimeout(50); // ステッパー行が消えてレイアウトが戻るのを待つ
({ cx, cy } = await center());
await page.mouse.move(cx - 100, cy + 100);
await page.mouse.down();
await page.mouse.move(cx - 60, cy + 60, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);

memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
const textAfter = memos.find((m) => m.kind === "text");
console.log("TEXT_MOVED", textAfter.x !== textBeforeX || textAfter.y !== textBeforeY);
console.log("TEXT_CONTENT_UNCHANGED_BY_MOVE", textAfter.text === textBeforeContent);
console.log("TEXT_MOVE_DID_NOT_OPEN_EDITOR", !(await page.locator(".text-editor-overlay").isVisible()));

console.log("CONSOLE_ERRORS", JSON.stringify(errors));
await browser.close();
