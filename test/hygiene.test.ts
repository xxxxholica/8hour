import { describe, expect, it } from "vitest";
import {
  findForbiddenContent,
  validateAuthorEmail,
  validateCommitMessage,
  validateSubjectDescription,
} from "../scripts/check-hygiene.mjs";

describe("check-hygiene", () => {
  it("正しい Conventional Commits (日本語 + 本文 + Co-Authored-By) を通す", () => {
    const msg = [
      "feat(toolbar): 道具解除ショートカットを追加",
      "",
      "- Escape キーで選択中の道具を解除できるようにする",
      "",
      "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
    ].join("\n");
    expect(validateCommitMessage(msg)).toEqual([]);
  });

  it("Merge / Revert コミットを通す", () => {
    expect(validateCommitMessage("Merge branch 'fix/timer-rewind'")).toEqual([]);
    expect(validateCommitMessage('Revert "feat(toolbar): 道具解除ショートカットを追加"')).toEqual([]);
  });

  it("type が無い、または英語のみの要約を弾く", () => {
    const noType = validateCommitMessage("toolbar: 道具解除ショートカットを追加");
    expect(noType).toHaveLength(1);

    const englishOnly = validateCommitMessage("feat(toolbar): add clear shortcut");
    expect(englishOnly).toHaveLength(1);

    // Dependabot 等の自動生成コミットでは allowEnglish: true で Conventional Commits 形式のみを通す
    expect(validateCommitMessage("chore(deps-dev): bump vite", { allowEnglish: true })).toEqual([]);
    expect(validateCommitMessage("bump vite", { allowEnglish: true })).toHaveLength(1);
  });

  it("1行目と本文の間に空行がない場合を弾く", () => {
    const msg = "fix(toolbar): ボタンの配置を修正\n2行目に直接本文を書く";
    const errs = validateCommitMessage(msg);
    expect(errs.some((e) => e.includes("空行"))).toBe(true);
  });

  it("1行目の PR 番号と、要約の鉤括弧・丸括弧を弾く(scope の括弧は通す)", () => {
    expect(validateCommitMessage("feat(toolbar,canvas): 道具解除とテキスト確定の連携を改善")).toEqual([]);

    const prNumber = validateCommitMessage("fix(toolbar): 埋まる不具合を直す (#111)");
    expect(prNumber).toHaveLength(1);
    expect(prNumber[0]).toContain("PR 番号");

    for (const subject of [
      "feat(toolbar): 「移動・並べ替え」を追加",
      "feat(toolbar): 『移動・並べ替え』を追加",
      "feat(toolbar): 8HOUR(8時間)を追加",
      "feat(toolbar): 8HOUR（8時間）を追加",
    ]) {
      expect(validateCommitMessage(subject)).toHaveLength(1);
    }

    // 本文の括弧は対象外
    expect(validateCommitMessage("fix(toolbar): ボタンを直す\n\n- 初回描画時(リロード直後)のちらつきを抑える")).toEqual([]);
  });

  it("PR タイトルの PR 番号と括弧を検出する", () => {
    expect(validateSubjectDescription("ボタンを直す", "PR タイトル")).toEqual([]);
    expect(validateSubjectDescription("「ボタン」を直す", "PR タイトル")).toHaveLength(1);
  });

  it("Claude-Session やセッション URL を含むコミットメッセージを弾く", () => {
    const trailer = "feat(toolbar): 画面を整理\n\nClaude-" + "Session: https://claude.ai/code/session_01AbCdEf";
    const errs = validateCommitMessage(trailer);
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });

  it("Author メールアドレスの .local や個人のメールアドレスを弾く", () => {
    expect(validateAuthorEmail("202958124+xxxxholica@users.noreply.github.com")).toEqual([]);
    expect(validateAuthorEmail("49699333+dependabot[bot]@users.noreply.github.com")).toEqual([]);
    expect(validateAuthorEmail("noreply@github.com")).toEqual([]);
    expect(validateAuthorEmail("noreply@anthropic.com")).toEqual([]);

    expect(validateAuthorEmail("user@MyMacBook-Air.local")).toHaveLength(1);
    expect(validateAuthorEmail("someone@gmail.com")).toHaveLength(1);
    expect(validateAuthorEmail("user@example.com")).toHaveLength(1);
  });

  it("ファイルや PR 本文内のローカルパス・セッション URL を検出する", () => {
    expect(findForbiddenContent('const path = "./public/assets";', "src/main.ts")).toEqual([]);

    const macPath = findForbiddenContent('const p = "/Users/" + "alice/project";', "src/main.ts");
    expect(macPath).toHaveLength(0);

    const macLiteral = findForbiddenContent('const p = "/U' + 'sers/alice/project";', "src/main.ts");
    expect(macLiteral).toHaveLength(1);

    const winLiteral = findForbiddenContent("cloned to C:\\U" + "sers\\alice\\Downloads", "PR 本文");
    expect(winLiteral).toHaveLength(1);
  });
});
