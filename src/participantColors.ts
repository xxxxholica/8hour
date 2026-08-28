/**
 * フェーズ①(ideation)の色プール。参加者ごとに割り当てられたcolor_indexに
 * 対応する固定8色（dataviz色覚検証済みカテゴリカルパレット、色相だけを
 * 均等割りする方式から変更——validate_palette.jsで全ペアの色覚シミュレーション
 * を検定したところ、色相だけを回す方式は8色時点で既に見分けが困難なペアが
 * 出ることが判明したため、実際に検証済みの固定パレットに差し替えた）。
 * 参加人数の上限は、この8色ではなくレンズ分割表示側の事情(lensSplit.ts
 * LENS_COUNT=4、3組以上は表示が安定しないため撤回)で4人までに制限している
 * (sessionPanel.ts)——パレット自体は8色のうち先頭4色だけが実際に使われる。
 *
 * smuiView.tsから抽出——canvasView.tsのレンズ分割描画（メモの色からレンズ番号を
 * 逆引きする）が、より上位レイヤーのsmuiView.tsを逆importしなくて済むようにする。
 */
const PARTICIPANT_COLORS = [
  "#2a78d6", // 青
  "#eb6834", // 橙
  "#1baf7a", // 水
  "#eda100", // 黄
  "#e87ba4", // 赤紫
  "#008300", // 緑
  "#4a3aa7", // 紫
  "#e34948", // 赤
] as const;

export function colorForIndex(index: number): string {
  return PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length];
}

/**
 * メモの色から、その色を強制されている参加者のcolor_index（=レンズ分割表示での
 * レンズ番号）を逆引きする。PARTICIPANT_COLORSのいずれとも一致しない色（セッション
 * 開始前に自由に書かれたメモ等）はnullを返す——呼び出し側で「未帰属」として扱う。
 */
export function lensIndexForColor(color: string): number | null {
  const index = PARTICIPANT_COLORS.indexOf(color as (typeof PARTICIPANT_COLORS)[number]);
  return index === -1 ? null : index;
}
