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

// テキスト道具に切り替える
await page.locator('.toolbar-btn[aria-label="テキスト"]').click();
const stepperVisible = await page.locator(".font-size-stepper").isVisible();
console.log("FONT_SIZE_STEPPER_VISIBLE", stepperVisible);

// 文字サイズを「小」にしてみる
await page.getByRole("button", { name: "文字サイズ: 小" }).click();

const box = await page.locator("canvas.circle-canvas").boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

// 円の中をタップしてテキスト入力を開始する
await page.mouse.click(cx - 40, cy - 60);
await page.waitForTimeout(150);
const editorVisible = await page.locator(".text-editor-overlay").isVisible();
console.log("EDITOR_VISIBLE_AFTER_TAP", editorVisible);

await page.keyboard.type("こんにちは\nテキストメモ");
await page.waitForTimeout(100);
await page.screenshot({ path: "/tmp/text-1-editing.png" });

// 円の外（本文の別の場所）をクリックしてぼかし、確定させる
await page.locator("body").click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/text-2-committed.png" });

let memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT_AFTER_TEXT", memos.length);
console.log("TEXT_MEMO", JSON.stringify({
  kind: memos[0]?.kind,
  text: memos[0]?.text,
  textLines: memos[0]?.textLines,
  fontSize: memos[0]?.fontSize,
}));

// 空のテキストを確定しようとしても新しいメモは作られない
await page.mouse.click(cx + 60, cy + 60);
await page.waitForTimeout(100);
await page.locator("body").click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(150);
memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT_AFTER_EMPTY_TAP", memos.length);

// Escapeで取り消せる（新規作成の場合）
await page.mouse.click(cx - 60, cy + 60);
await page.waitForTimeout(100);
await page.keyboard.type("消えるはず");
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT_AFTER_ESCAPE", memos.length);

// バグ修正の確認：日本語IME変換中のEscapeは「変換候補を閉じる」ためのキー入力であり、
// 入力全体の取り消しではない。isComposing:trueの状態でEscapeを送っても、
// 入力中の内容やエディタの表示は消えてはいけない
await page.mouse.click(cx + 60, cy - 60);
await page.waitForTimeout(100);
await page.keyboard.type("かな");
await page.waitForTimeout(50);
await page.locator(".text-editor-overlay").evaluate((el) => {
  const ev = new KeyboardEvent("keydown", { key: "Escape", isComposing: true, cancelable: true });
  el.dispatchEvent(ev);
});
await page.waitForTimeout(100);
console.log("IME_ESCAPE_EDITOR_STAYS_OPEN", await page.locator(".text-editor-overlay").isVisible());
console.log("IME_ESCAPE_TEXT_PRESERVED", (await page.locator(".text-editor-overlay").inputValue()) === "かな");

// IME変換中でない、通常のEscapeでは今までどおり取り消される
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
console.log("REAL_ESCAPE_EDITOR_CLOSES", !(await page.locator(".text-editor-overlay").isVisible()));
memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("REAL_ESCAPE_MEMO_COUNT_UNCHANGED", memos.length);

// --- ここからテキスト編集機能のテスト ---

// テキスト道具に戻し、既存のテキストメモをタップすると編集が開く（既存内容が入っている）
await page.locator('.toolbar-btn[aria-label="テキスト"]').click();
await page.mouse.click(cx - 40, cy - 60);
await page.waitForTimeout(150);
const editorVisibleForEdit = await page.locator(".text-editor-overlay").isVisible();
const prefillValue = await page.locator(".text-editor-overlay").inputValue();
console.log("EDIT_EDITOR_VISIBLE", editorVisibleForEdit);
console.log("EDIT_PREFILL_MATCHES_ORIGINAL", prefillValue === "こんにちは\nテキストメモ");

// 内容を書き換えて確定する
await page.keyboard.press("End");
await page.keyboard.type("（編集済み）");
await page.waitForTimeout(50);
await page.locator("body").click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(150);
memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("EDIT_TEXT_UPDATED", memos[0].text === "こんにちは\nテキストメモ（編集済み）");
console.log("EDIT_MEMO_COUNT_UNCHANGED", memos.length === 1);

// 編集中にEscapeを押すと、内容を書き換えても元のまま変更が破棄される
const beforeEscapeEditText = memos[0].text;
await page.mouse.click(cx - 40, cy - 60);
await page.waitForTimeout(150);
await page.keyboard.press("End");
await page.keyboard.type("これは保存されないはず");
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("EDIT_ESCAPE_LEAVES_UNCHANGED", memos[0].text === beforeEscapeEditText);
console.log("EDIT_ESCAPE_MEMO_COUNT_UNCHANGED", memos.length === 1);

// 編集で全文を消して確定すると、メモごと削除される
await page.mouse.click(cx - 40, cy - 60);
await page.waitForTimeout(150);
await page.keyboard.press("Control+A");
await page.keyboard.press("Backspace");
await page.locator("body").click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(150);
memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("EDIT_EMPTY_DELETES_MEMO", memos.length === 0);

// --- 消しゴムのテスト用に、あらためて1件作る ---
await page.mouse.click(cx - 40, cy - 60);
await page.waitForTimeout(100);
await page.keyboard.type("消しゴム用");
await page.locator("body").click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(150);
memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT_BEFORE_ERASE", memos.length);

// 消しゴムでテキストメモを消す
await page.locator('.toolbar-btn[aria-label="消しゴム"]').click();
await page.mouse.move(cx - 40, cy - 60);
await page.mouse.down();
await page.mouse.move(cx - 35, cy - 55);
await page.mouse.up();
await page.waitForTimeout(150);
memos = await page.evaluate(() => JSON.parse(localStorage.getItem("memos") ?? "[]"));
console.log("MEMO_COUNT_AFTER_ERASE", memos.length);

console.log("CONSOLE_ERRORS", JSON.stringify(errors));
await browser.close();
