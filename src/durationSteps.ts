interface DurationStep {
  label: string;
  ms: number;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 振り返りスライダー（rewindSelector.ts）が遡れる幅の元になる目盛り。8段階
 * （15分〜3日）。
 *
 * 「消えるまでの期間」はユーザーが選べる仕様をやめ常に1日固定にしたため
 * （ユーザー指示、fade.tsのFIXED_LIFESPAN_DAYS参照）、この配列はもう
 * 期間選択の目盛りとしては使わない。3日という上限は、なぞって復活できる
 * 回数に上限を設けた（Issue #11）当時に決めた値をそのまま引き継いでいる
 * ——「消えたものを掘り返せる道具」にはしたくないという、振り返り側の
 * 検索性を意図的に下げる設計判断（rewindSelector.ts参照）とも合致するため。
 */
export const DURATION_STEPS: DurationStep[] = [
  { label: "15分", ms: 15 * MINUTE },
  { label: "30分", ms: 30 * MINUTE },
  { label: "1時間", ms: 1 * HOUR },
  { label: "3時間", ms: 3 * HOUR },
  { label: "6時間", ms: 6 * HOUR },
  { label: "12時間", ms: 12 * HOUR },
  { label: "1日", ms: 1 * DAY },
  { label: "3日", ms: 3 * DAY },
];
