import { describe, expect, it } from "vitest";
import {
  autoConvertBullet,
  backspaceAtMarker,
  continueList,
  indentLines,
  isBlankText,
  moveItemToSlot,
  outdentLines,
  parseListLine,
  renumber,
  reorderParagraphs,
  startNextLine,
  stripTrailingBlankLines,
  toggleMarker,
  type EditState,
} from "../src/textList";

/** "|" の位置にキャレットがある状態を作る（"|"は文字列から取り除く）。 */
function at(textWithCaret: string): EditState {
  const i = textWithCaret.indexOf("|");
  const value = textWithCaret.replace("|", "");
  return { value, start: i, end: i };
}

/** 結果を、キャレット位置に"|"を挿した文字列にして比較しやすくする。 */
function show(state: EditState | null): string | null {
  if (!state) return null;
  return state.value.slice(0, state.start) + "|" + state.value.slice(state.start);
}

describe("parseListLine", () => {
  it("箇条書き・番号・括弧番号と、行頭のインデントを認識する", () => {
    expect(parseListLine("・ メモ")).toMatchObject({ kind: "bullet", markerText: "・ ", contentStart: 2 });
    expect(parseListLine("・メモ")).toMatchObject({ kind: "bullet", markerText: "・", contentStart: 1 });
    expect(parseListLine("12. メモ")).toMatchObject({ kind: "dot", number: 12, contentStart: 4 });
    expect(parseListLine("(3) メモ")).toMatchObject({ kind: "paren", number: 3, contentStart: 4 });
    expect(parseListLine("　　・ メモ")).toMatchObject({ kind: "bullet", indent: "　　", contentStart: 4 });
  });

  it("記号でない行はnull（区切りスペースの無い「1.5」など）", () => {
    expect(parseListLine("ふつうの文")).toBeNull();
    expect(parseListLine("1.5倍")).toBeNull();
    expect(parseListLine("1.")).toBeNull();
  });
});

describe("continueList（Shift+Enterでの改行）", () => {
  it("箇条書きの行末で、次の項目の記号を入れる", () => {
    expect(show(continueList(at("・ りんご|")))).toBe("・ りんご\n・ |");
  });

  it("番号付きは番号を+1する", () => {
    expect(show(continueList(at("1. a|")))).toBe("1. a\n2. |");
    expect(show(continueList(at("(2) a|")))).toBe("(2) a\n(3) |");
  });

  it("行の途中なら、キャレットより後ろの文字を新しい項目へ送る", () => {
    expect(show(continueList(at("・ あい|うえ")))).toBe("・ あい\n・ |うえ");
  });

  it("後ろにある番号を連番に振り直す", () => {
    expect(show(continueList(at("1. a|\n2. b")))).toBe("1. a\n2. |\n3. b");
  });

  it("入れ子のインデントを引き継ぐ", () => {
    expect(show(continueList(at("　・ a|")))).toBe("　・ a\n　・ |");
  });

  it("記号だけの空の項目では、記号を消してリストを抜ける", () => {
    expect(show(continueList(at("・ a\n・ |")))).toBe("・ a\n|");
  });

  it("入れ子の空の項目では、1段階戻す", () => {
    expect(show(continueList(at("・ a\n　・ |")))).toBe("・ a\n・ |");
  });

  it("リストの行でない・記号の手前・範囲選択のときはnull（通常の改行に任せる）", () => {
    expect(continueList(at("ふつう|"))).toBeNull();
    expect(continueList(at("|・ a"))).toBeNull();
    expect(continueList({ value: "・ abc", start: 2, end: 4 })).toBeNull();
  });
});

describe("autoConvertBullet", () => {
  it("行頭の「- 」「* 」を「・ 」へ変換する", () => {
    expect(show(autoConvertBullet(at("- |")))).toBe("・ |");
    expect(show(autoConvertBullet(at("a\n* |")))).toBe("a\n・ |");
    expect(show(autoConvertBullet(at("　- |")))).toBe("　・ |");
  });

  it("行の途中の「- 」や、文章の続きは変換しない", () => {
    expect(autoConvertBullet(at("a - |"))).toBeNull();
    expect(autoConvertBullet(at("-|"))).toBeNull();
  });
});

describe("backspaceAtMarker", () => {
  it("記号の直後のBackspaceで、記号だけを消す", () => {
    expect(show(backspaceAtMarker(at("・ |メモ")))).toBe("|メモ");
    expect(show(backspaceAtMarker(at("　2. |メモ")))).toBe("　|メモ");
  });

  it("それ以外の位置ではnull（通常のBackspace）", () => {
    expect(backspaceAtMarker(at("・ メ|モ"))).toBeNull();
    expect(backspaceAtMarker(at("ふつう|"))).toBeNull();
  });
});

describe("indentLines / outdentLines", () => {
  it("番号付きの項目をインデントすると、その階層は1から始まる", () => {
    expect(show(indentLines(at("1. a\n2. b|")))).toBe("1. a\n　1. b|");
  });

  it("インデントを戻すと、親の階層の連番に戻る", () => {
    expect(show(outdentLines(at("1. a\n　1. b|")))).toBe("1. a\n2. b|");
  });

  it("選択した複数行をまとめて動かす", () => {
    const result = indentLines({ value: "a\nb\nc", start: 0, end: 3 });
    expect(result.value).toBe("　a\n　b\nc");
  });

  it("インデントの無い行のアウトデントは何もしない", () => {
    expect(outdentLines(at("a|")).value).toBe("a");
  });

  it("記号の無い行にも使える", () => {
    expect(show(indentLines(at("ab|")))).toBe("　ab|");
  });
});

describe("toggleMarker（ツールバーの「・」「1.」）", () => {
  it("記号の無い行に記号を付け、もう一度押すと外す", () => {
    const on = toggleMarker(at("メモ|"), "bullet");
    expect(show(on)).toBe("・ メモ|");
    expect(show(toggleMarker(on, "bullet"))).toBe("メモ|");
  });

  it("別の種類の記号は置き換える", () => {
    expect(show(toggleMarker(at("・ メモ|"), "dot"))).toBe("1. メモ|");
  });

  it("選択した複数行を番号付きにすると連番になる", () => {
    const result = toggleMarker({ value: "a\nb\nc", start: 0, end: 5 }, "dot");
    expect(result.value).toBe("1. a\n2. b\n3. c");
  });

  it("入れ子のインデントは保つ", () => {
    expect(show(toggleMarker(at("　メモ|"), "bullet"))).toBe("　・ メモ|");
  });
});

describe("renumber", () => {
  it("最上位の最初の番号はそのまま使い、以降を連番にする", () => {
    expect(renumber({ value: "3. a\n9. b\n1. c", start: 0, end: 0 }).value).toBe("3. a\n4. b\n5. c");
  });

  it("通常の行をはさむと連番は途切れる", () => {
    expect(renumber({ value: "1. a\nふつう\n5. b", start: 0, end: 0 }).value).toBe("1. a\nふつう\n5. b");
  });

  it("階層ごとに数える", () => {
    const value = "1. a\n　1. x\n　2. y\n2. b\n　5. z";
    expect(renumber({ value, start: 0, end: 0 }).value).toBe("1. a\n　1. x\n　2. y\n2. b\n　1. z");
  });

  it("桁数が変わっても、キャレットは同じ文字の位置に残る", () => {
    const state = renumber({ value: "9. a\n9. bc", start: 9, end: 9 }); // "bc"のb|c
    expect(state.value).toBe("9. a\n10. bc");
    expect(state.value.slice(0, state.start)).toBe("9. a\n10. b");
  });
});

describe("isBlankText", () => {
  it("空・空白・記号だけの行ばかりなら空とみなす", () => {
    expect(isBlankText("")).toBe(true);
    expect(isBlankText("・ \n  \n1. ")).toBe(true);
    expect(isBlankText("・ a")).toBe(false);
  });
});

describe("stripTrailingBlankLines", () => {
  it("末尾の空行・記号だけの行を取り除き、本文のある行は残す", () => {
    expect(stripTrailingBlankLines("・ a\n・ b\n　・ \n\n")).toBe("・ a\n・ b");
    expect(stripTrailingBlankLines("・ a\n\n・ b")).toBe("・ a\n\n・ b");
    expect(stripTrailingBlankLines("・ \n")).toBe("");
  });
});

describe("startNextLine（既存メモの続きを書き始める）", () => {
  it("通常の文章は末尾に改行を足す", () => {
    expect(startNextLine("ふつうの文")).toBe("ふつうの文\n");
  });

  it("最後の行がリストの項目なら、次の項目の記号も入れる", () => {
    expect(startNextLine("・ a\n・ b")).toBe("・ a\n・ b\n・ ");
    expect(startNextLine("1. a\n2. b")).toBe("1. a\n2. b\n3. ");
  });
});

describe("reorderParagraphs（行の入れ替え）", () => {
  const text = "a\nb\nc\nd";

  it("下の行を上のスロットへ、上の行を下のスロットへ移す", () => {
    expect(reorderParagraphs(text, 2, 0)).toBe("c\na\nb\nd");
    expect(reorderParagraphs(text, 0, 3)).toBe("b\nc\na\nd");
    expect(reorderParagraphs(text, 0, 4)).toBe("b\nc\nd\na");
    expect(reorderParagraphs(text, 3, 1)).toBe("a\nd\nb\nc");
  });

  it("元と同じ位置（自分の手前・直後）や範囲外は何もしない", () => {
    expect(reorderParagraphs(text, 1, 1)).toBe(text);
    expect(reorderParagraphs(text, 1, 2)).toBe(text);
    expect(reorderParagraphs(text, 9, 0)).toBe(text);
    expect(reorderParagraphs(text, 1, 9)).toBe(text);
  });

  it("番号付きリストは、入れ替えたあとも1から連番に振り直す", () => {
    expect(reorderParagraphs("1. a\n2. b\n3. c", 2, 0)).toBe("1. c\n2. a\n3. b");
  });

  it("箇条書きの記号や、空行はそのまま動く", () => {
    expect(reorderParagraphs("・ a\n\n・ b", 2, 0)).toBe("・ b\n・ a\n");
  });

  it("moveItemToSlotは配列要素を指定スロットへ移動し、無変更や範囲外ではnullを返す", () => {
    expect(moveItemToSlot(["a", "b", "c"], 0, 3)).toEqual(["b", "c", "a"]);
    expect(moveItemToSlot(["a", "b", "c"], 1, 1)).toBeNull();
    expect(moveItemToSlot(["a", "b", "c"], 1, 2)).toBeNull();
    expect(moveItemToSlot(["a", "b", "c"], -1, 0)).toBeNull();
  });
});
