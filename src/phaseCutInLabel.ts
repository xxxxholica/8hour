import { PHASE_LABEL } from "./sessionPanel";
import type { SessionState } from "./sharedCanvas";

/**
 * フェーズが実際に切り替わった時だけ、カットインに出す文言を返す
 * （変わっていなければnull＝表示しない）。smuiView.applySession()から、
 * 直前のフェーズ(prevPhase)と新しいセッション状態を渡して呼ぶ。
 * "results"(投票確定後の結果ロック、issue #114/#119対応)に入った瞬間だけは
 * 「結果発表開始」という不自然な言い回しを避け、「結果発表」とだけ出す。
 */
export function phaseCutInLabel(prevPhase: SessionState["phase"] | null, session: SessionState | null): string | null {
  if (session && session.phase !== prevPhase) {
    return session.phase === "results" ? "結果発表" : `${PHASE_LABEL[session.phase]}開始`;
  }
  return null;
}
