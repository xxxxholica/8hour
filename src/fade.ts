import type { LifespanDays } from "./types";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 標準ペンの基準となる猶予期間（日）。7日で完全消滅する固定カーブの基準値。 */
export const STANDARD_LIFESPAN_DAYS = 7;

/** 「消えるまでの期間」は選べず常にこの値（1日）で固定する（ユーザー指示：
 *  視認負荷低減のため、期間を選ぶという操作自体を無くす）。 */
export const FIXED_LIFESPAN_DAYS: LifespanDays = 1;

/**
 * 標準ペンの絶対しきい値（時間）を7日ぶんの比率に換算したもの。
 * 期間指定ペンはこの比率をそのまま指定日数にスケールして使う。
 *   24時間 / 7日 = 1/7  … 100%→60%
 *   3日    / 7日 = 3/7  … 60%→20%
 *   7日    / 7日 = 1    … 20%→消滅
 */
const RATIO_TO_60 = 24 / (STANDARD_LIFESPAN_DAYS * 24);
const RATIO_TO_20 = (24 * 3) / (STANDARD_LIFESPAN_DAYS * 24);
const RATIO_TO_FADED = 1;

type FadeStage = 1 | 0.6 | 0.2 | 0;

/**
 * 経過時間と猶予期間（lifespanDays）から不透明度を計算する。
 * lifespanDays が null の場合は標準ペン（7日基準の固定カーブ）として扱う。
 * 期間指定ペンは同じ4段階カーブを lifespanDays に比例させて適用する
 * （例: 1日指定なら 24h/7 ≒ 3.4h で60%、24h*3/7 ≒ 10.3h で20%、24hで消滅）。
 */
export function computeOpacity(
  elapsedMs: number,
  lifespanDays: LifespanDays
): FadeStage {
  if (elapsedMs < 0) return 1;
  const totalMs = (lifespanDays ?? STANDARD_LIFESPAN_DAYS) * MS_PER_DAY;
  if (totalMs <= 0) return 0;
  const ratio = elapsedMs / totalMs;
  if (ratio < RATIO_TO_60) return 1;
  if (ratio < RATIO_TO_20) return 0.6;
  if (ratio < RATIO_TO_FADED) return 0.2;
  return 0;
}

export function isFaded(elapsedMs: number, lifespanDays: LifespanDays): boolean {
  return computeOpacity(elapsedMs, lifespanDays) === 0;
}

/** 完全消滅までの残りミリ秒（負値にはならない）。 */
export function remainingMs(elapsedMs: number, lifespanDays: LifespanDays): number {
  const totalMs = (lifespanDays ?? STANDARD_LIFESPAN_DAYS) * MS_PER_DAY;
  return Math.max(0, totalMs - Math.max(0, elapsedMs));
}

/**
 * 振り返り（タイムラインスライダー）用: なぞり直した時刻の履歴（traceHistory、
 * 先頭は必ずcreatedAt）から、過去の任意時刻tにおける不透明度を再現する。
 * tがcreatedAtより前ならまだ存在しないのでnullを返す。
 * traceHistoryは作成順（昇順）に追記される前提。
 */
export function opacityAtTime(
  traceHistory: readonly number[],
  lifespanDays: LifespanDays,
  t: number
): number | null {
  if (traceHistory.length === 0) return null;
  const createdAt = traceHistory[0];
  if (t < createdAt) return null;

  let latestTraceAtOrBefore = createdAt;
  for (const trace of traceHistory) {
    if (trace > t) break;
    latestTraceAtOrBefore = trace;
  }
  return computeOpacity(t - latestTraceAtOrBefore, lifespanDays);
}
