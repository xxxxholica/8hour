import type { Point } from "./types";

/** currentReviveInfoTargetの判定に必要な、CircularCanvasのDrawStateの一部だけを
 *  構造的に受け取る（canvasView.tsのDrawStateはexportされていないため、
 *  循環参照を避けてこのファイル独自の最小限の型で受け取る）。 */
interface ReviveInfoDrawState {
  mode: "idle" | "drawing" | "tracing" | "erasing" | "moving" | "pinching";
  tracingMemoId: string | null;
  movingMemoId: string | null;
  lastPoint: Point | null;
}

/**
 * 「残り時間」を今どのメモについて出すべきかを、優先順位（実際になぞっている
 * ＞実際に移動している＞PCでのホバー）で決める。該当が無ければnull。
 * 表示自体はDOM側（main.ts/smuiView.tsが持つピル、旧reviveInfoBox.tsの
 * canvas描画から置き換え——ユーザー指摘：輪郭線があると目立ちすぎる／
 * ツールバー直上に共有ルームのボタンと同じ見た目で出したい）が担う。
 */
export function currentReviveInfoTarget(
  state: ReviveInfoDrawState,
  hoverInfoMemoId: string | null,
  hoverInfoPoint: Point | null
): { memoId: string; point: Point } | null {
  if (state.mode === "tracing" && state.tracingMemoId && state.lastPoint) {
    return { memoId: state.tracingMemoId, point: state.lastPoint };
  }
  if (state.mode === "moving" && state.movingMemoId && state.lastPoint) {
    return { memoId: state.movingMemoId, point: state.lastPoint };
  }
  if (hoverInfoMemoId && hoverInfoPoint) {
    return { memoId: hoverInfoMemoId, point: hoverInfoPoint };
  }
  return null;
}
