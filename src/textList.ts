/**
 * 行モードのテキスト入力で使う、Notion風の軽いリスト記法（「・」「1. 」「(1) 」）の
 * 編集ロジック。DOMには触れない純粋関数だけで構成し、textareaの内容と選択範囲
 * （EditState）を受け取って、編集後のEditStateを返す（canvasView.openTextEditorが
 * textareaへ反映する）。
 *
 * 記号は本文にそのまま文字として保存する（専用のデータ構造は持たない）。
 * 入れ子の深さは行頭の全角スペース（INDENT_UNIT）の数で表す。
 */

/** 1段階のインデント（全角スペース1つ＝文字1つぶん）。 */
const INDENT_UNIT = "　";

export interface EditState {
  value: string;
  /** 選択範囲の開始・終了位置（textareaのselectionStart/End）。 */
  start: number;
  end: number;
}

type ListKind = "bullet" | "dot" | "paren";

interface ListMarker {
  /** 行頭のインデント（全角スペース・半角スペース）。 */
  indent: string;
  kind: ListKind;
  /** 番号付き（dot/paren）のときの番号。bulletでは0。 */
  number: number;
  /** インデントを除いた記号の文字列（末尾の区切りスペースを含む。例: "・ "、"2. "）。 */
  markerText: string;
  /** 行内での本文の開始位置（インデント＋記号の長さ）。 */
  contentStart: number;
}

const BULLET_RE = /^([ 　]*)(・[ 　]?)/;
const DOT_RE = /^([ 　]*)(\d{1,3})\.[ 　]/;
const PAREN_RE = /^([ 　]*)[(（](\d{1,3})[)）][ 　]/;

/** 1行（改行を含まない）の行頭がリスト記法なら、その情報を返す。 */
export function parseListLine(line: string): ListMarker | null {
  let m = BULLET_RE.exec(line);
  if (m) {
    return { indent: m[1], kind: "bullet", number: 0, markerText: m[2], contentStart: m[0].length };
  }
  m = DOT_RE.exec(line);
  if (m) {
    return {
      indent: m[1],
      kind: "dot",
      number: Number(m[2]),
      markerText: m[0].slice(m[1].length),
      contentStart: m[0].length,
    };
  }
  m = PAREN_RE.exec(line);
  if (m) {
    return {
      indent: m[1],
      kind: "paren",
      number: Number(m[2]),
      markerText: m[0].slice(m[1].length),
      contentStart: m[0].length,
    };
  }
  return null;
}

function formatMarker(kind: ListKind, number: number): string {
  if (kind === "bullet") return "・ ";
  if (kind === "dot") return `${number}. `;
  return `(${number}) `;
}

/** 同じ種類の次の項目の記号。箇条書きは今の記号をそのまま、番号付きは番号を+1。 */
function nextMarkerText(m: ListMarker): string {
  if (m.kind === "bullet") return m.markerText;
  return formatMarker(m.kind, m.number + 1);
}

/** posを含む行の[start, end)（endは改行の位置、または文字列の末尾）。 */
function lineBounds(value: string, pos: number): { start: number; end: number } {
  const start = pos === 0 ? 0 : value.lastIndexOf("\n", pos - 1) + 1;
  const nl = value.indexOf("\n", pos);
  return { start, end: nl < 0 ? value.length : nl };
}

/** 選択範囲にかかる行の[start, end)の一覧。選択の終端が行頭ちょうどなら、その行は含めない。 */
function selectedLines(state: EditState): { start: number; end: number }[] {
  const lines: { start: number; end: number }[] = [];
  let pos = lineBounds(state.value, state.start).start;
  const last = state.end > state.start ? state.end - 1 : state.end;
  for (;;) {
    const b = lineBounds(state.value, pos);
    lines.push(b);
    if (b.end >= last || b.end >= state.value.length) break;
    pos = b.end + 1;
  }
  return lines;
}

/** リスト記法を除いた本文が空（空白のみ）の行か。記号だけの行・空行はtrue。 */
function isBlankLine(line: string): boolean {
  const m = parseListLine(line);
  return (m ? line.slice(m.contentStart) : line).trim() === "";
}

/** 全行が空、または記号だけなら、何も書かれていないとみなす（確定時の空判定に使う）。 */
export function isBlankText(text: string): boolean {
  return text.split("\n").every(isBlankLine);
}

/**
 * 既存のテキストの続きを書き始めるときの入力欄の初期値。末尾に改行を足し、最後の行が
 * リストの項目なら次の項目の記号も入れる。
 */
export function startNextLine(text: string): string {
  const next = continueList({ value: text, start: text.length, end: text.length });
  return next ? next.value : `${text}\n`;
}

/**
 * 配列の要素fromを、スロットslot（0〜要素数、「slot番目の要素の手前」）へ移した
 * 新しい配列を返す。範囲外、または移動前と同じ位置（slot === from / from + 1）の
 * ときはnullを返す。
 */
export function moveItemToSlot<T>(items: readonly T[], from: number, slot: number): T[] | null {
  if (from < 0 || from >= items.length || slot < 0 || slot > items.length) return null;
  if (slot === from || slot === from + 1) return null;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(slot > from ? slot - 1 : slot, 0, moved);
  return next;
}

/**
 * 段落（改行で区切られた1行）fromを、スロットslot（0〜段落数、「slot番目の段落の手前」）
 * へ移す。移さない場合（範囲外、または移動前と同じ位置）は元のtextをそのまま返す。
 * 番号付きリストは、最上位の階層を1から振り直す（入れ替えても連番が崩れないように）。
 */
export function reorderParagraphs(text: string, from: number, slot: number): string {
  const moved = moveItemToSlot(text.split("\n"), from, slot);
  if (!moved) return text;
  return renumber({ value: moved.join("\n"), start: 0, end: 0 }, { restartAtOne: true }).value;
}

/** 末尾の、空・空白・記号だけの行（書きかけの空の項目など）を取り除く。 */
export function stripTrailingBlankLines(text: string): string {
  const lines = text.split("\n");
  while (lines.length > 0 && isBlankLine(lines[lines.length - 1])) lines.pop();
  return lines.join("\n");
}

/**
 * Shift+Enter（モバイルはEnter）で改行するとき、リストの行なら次の項目の記号を
 * 自動で挿入する。記号だけの空の項目で押したときはリストを抜ける（入れ子なら
 * 1段階戻る）。リストの行でなければnull（呼び出し側が通常の改行をする）。
 */
export function continueList(state: EditState): EditState | null {
  if (state.start !== state.end) return null;
  const { start: ls, end: le } = lineBounds(state.value, state.start);
  const line = state.value.slice(ls, le);
  const marker = parseListLine(line);
  if (!marker) return null;
  const col = state.start - ls;
  if (col < marker.contentStart) return null; // 記号の途中・手前では通常の改行

  if (line.slice(marker.contentStart).trim() === "" && col >= line.trimEnd().length) {
    // 空の項目：入れ子なら1段階戻し、そうでなければ記号を消してリストを抜ける。
    if (marker.indent.length > 0) {
      return renumber(outdentLines({ value: state.value, start: state.start, end: state.end }));
    }
    const value = state.value.slice(0, ls) + state.value.slice(le);
    return renumber({ value, start: ls, end: ls });
  }

  const insertion = `\n${marker.indent}${nextMarkerText(marker)}`;
  const value = state.value.slice(0, state.start) + insertion + state.value.slice(state.start);
  const caret = state.start + insertion.length;
  return renumber({ value, start: caret, end: caret });
}

/** 行頭が「- 」「* 」になった（スペースを打った直後）とき「・ 」へ変換する。 */
export function autoConvertBullet(state: EditState): EditState | null {
  if (state.start !== state.end) return null;
  const { start: ls } = lineBounds(state.value, state.start);
  const prefix = state.value.slice(ls, state.start);
  const m = /^([ 　]*)[-*] $/.exec(prefix);
  if (!m) return null;
  const replaced = `${m[1]}・ `;
  const value = state.value.slice(0, ls) + replaced + state.value.slice(state.start);
  const caret = ls + replaced.length;
  return { value, start: caret, end: caret };
}

/** 記号の直後（本文の先頭）でBackspaceを押したとき、記号だけを消して通常の行に戻す。 */
export function backspaceAtMarker(state: EditState): EditState | null {
  if (state.start !== state.end) return null;
  const { start: ls, end: le } = lineBounds(state.value, state.start);
  const line = state.value.slice(ls, le);
  const marker = parseListLine(line);
  if (!marker || state.start - ls !== marker.contentStart) return null;
  const markerStart = ls + marker.indent.length;
  const value = state.value.slice(0, markerStart) + state.value.slice(ls + marker.contentStart);
  return renumber({ value, start: markerStart, end: markerStart });
}

/** 選択範囲の各行のインデントを1段階増やす。 */
export function indentLines(state: EditState): EditState {
  return renumber(shiftIndent(state, 1));
}

/** 選択範囲の各行のインデントを1段階減らす（インデントが無い行はそのまま）。 */
export function outdentLines(state: EditState): EditState {
  return renumber(shiftIndent(state, -1));
}

function shiftIndent(state: EditState, dir: 1 | -1): EditState {
  const lines = selectedLines(state);
  let value = state.value;
  let start = state.start;
  let end = state.end;
  // 後ろの行から書き換えて、手前の行の位置がずれないようにする。
  for (let i = lines.length - 1; i >= 0; i--) {
    const { start: ls } = lines[i];
    let delta = 0;
    if (dir > 0) {
      value = value.slice(0, ls) + INDENT_UNIT + value.slice(ls);
      delta = INDENT_UNIT.length;
    } else {
      const head = value.slice(ls, ls + 2);
      const remove = head.startsWith(INDENT_UNIT) ? 1 : /^ {1,2}/.exec(head)?.[0].length ?? 0;
      if (remove > 0) {
        value = value.slice(0, ls) + value.slice(ls + remove);
        delta = -remove;
      }
    }
    if (delta !== 0) {
      if (start > ls) start = Math.max(ls, start + delta);
      if (end > ls) end = Math.max(ls, end + delta);
    }
  }
  return { value, start, end };
}

/**
 * 選択範囲の各行を、指定した種類のリストにする（ツールバーの「・」「1.」ボタン用）。
 * 選択した行がすべて既にその種類なら、記号を外して通常の行に戻す。
 */
export function toggleMarker(state: EditState, kind: ListKind): EditState {
  const lines = selectedLines(state);
  const allSame = lines.every(({ start, end }) => parseListLine(state.value.slice(start, end))?.kind === kind);
  let value = state.value;
  let start = state.start;
  let end = state.end;
  for (let i = lines.length - 1; i >= 0; i--) {
    const ls = lines[i].start;
    const le = lines[i].end;
    const line = value.slice(ls, le);
    const marker = parseListLine(line);
    const indentLen = marker ? marker.indent.length : /^[ 　]*/.exec(line)![0].length;
    const oldContentStart = marker ? marker.contentStart : indentLen;
    const newMarker = allSame ? "" : formatMarker(kind, 1);
    const newContentStart = indentLen + newMarker.length;
    value = value.slice(0, ls + indentLen) + newMarker + value.slice(ls + oldContentStart);
    const delta = newContentStart - oldContentStart;
    const remap = (p: number): number => {
      if (p < ls) return p;
      if (p - ls >= oldContentStart) return p + delta;
      return Math.min(p, ls + newContentStart);
    };
    start = remap(start);
    end = remap(end);
  }
  return renumber({ value, start, end });
}

/**
 * 番号付きリスト（「1. 」「(1) 」）の番号を、階層ごとに連番へ振り直す。
 * 連続する同じ種類の項目が1つの塊で、塊の最初の項目は、最上位の階層ならユーザーが
 * 打った番号をそのまま使い（options.restartAtOneなら1から）、入れ子の階層なら1から
 * 始める。箇条書き・通常の行をはさむとその階層以下の連番は途切れる。選択範囲は
 * 文字数の増減に合わせて補正する。
 */
export function renumber(state: EditState, options: { restartAtOne?: boolean } = {}): EditState {
  if (!/\d[.)）]/.test(state.value)) return state; // 番号付きの記法が無ければ何もしない
  const oldLines = state.value.split("\n");
  const counters = new Map<number, { kind: ListKind; n: number }>();
  const records: { oldStart: number; newStart: number; oldCS: number; newCS: number; oldLen: number }[] = [];
  const newLines: string[] = [];
  let oldPos = 0;
  let newPos = 0;
  for (const line of oldLines) {
    const marker = parseListLine(line);
    let out = line;
    let oldCS = 0;
    let newCS = 0;
    if (!marker) {
      counters.clear();
    } else {
      oldCS = marker.contentStart;
      newCS = oldCS;
      const depth = marker.indent.length;
      for (const d of [...counters.keys()]) if (d > depth) counters.delete(d);
      if (marker.kind === "bullet") {
        counters.delete(depth);
      } else {
        const prev = counters.get(depth);
        const n =
          prev && prev.kind === marker.kind ? prev.n + 1 : depth > 0 || options.restartAtOne ? 1 : marker.number;
        counters.set(depth, { kind: marker.kind, n });
        const text = formatMarker(marker.kind, n);
        if (text !== marker.markerText) {
          out = marker.indent + text + line.slice(marker.contentStart);
          newCS = marker.indent.length + text.length;
        }
      }
    }
    records.push({ oldStart: oldPos, newStart: newPos, oldCS, newCS, oldLen: line.length });
    newLines.push(out);
    oldPos += line.length + 1;
    newPos += out.length + 1;
  }
  const remap = (p: number): number => {
    for (const r of records) {
      if (p > r.oldStart + r.oldLen) continue;
      const col = p - r.oldStart;
      return r.newStart + (col >= r.oldCS ? col + (r.newCS - r.oldCS) : Math.min(col, r.newCS));
    }
    return p;
  };
  return { value: newLines.join("\n"), start: remap(state.start), end: remap(state.end) };
}
