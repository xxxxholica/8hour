import { loadCustomTemplates, saveCustomTemplates } from "./storage";

/** 組み込みテンプレートのidは固定の文字列だが、ユーザーが作成したテンプレートは
 *  実行時に生成するidを持つため、閉じた文字列リテラルの組合せ型ではなく単純な
 *  string にしている（"custom:"始まりで組み込みidと衝突しないようにする）。 */
export type TemplateId = string;

export interface TemplateDef {
  id: TemplateId;
  /** 全画面のテンプレート選択（templatePicker.ts）のカードに出す名前。 */
  label: string;
  /** カードに添える一行の説明。名前だけでは伝わらない使いどころを短く補う。 */
  description: string;
  /** 盤面に置く文面。項目は空欄のままにし、置いた後にテキスト道具でタップして書き込む
   *  （1つのテキストメモとしてそのまま置かれる。canvasView.tsのplaceTemplateAt参照）。
   *  選択画面のカードでは、この文面をそのままプレビューとして見せる。 */
  text: string;
}

const CUSTOM_ID_PREFIX = "custom:";

/**
 * 盤面にそのまま置けるテンプレート一覧。この配列の並び順が、全画面のテンプレート
 * 選択（templatePicker.ts）に並ぶ順序になる——個人利用で日常的なものを先に、
 * 構造だてて書くものを後に置いている。
 */
const TEMPLATES: TemplateDef[] = [
  {
    id: "checklist",
    label: "持ち物チェック",
    description: "出かける前の忘れ物確認に。チェック欄を5つ用意します",
    text: "持ち物チェック\n□ \n□ \n□ \n□ \n□ ",
  },
  {
    id: "buyList",
    label: "買い物リスト",
    description: "買うものを並べて、買えたものから消していきます",
    text: "買い物リスト\n□ \n□ \n□ \n□ \n買う場所: ",
  },
  {
    id: "dayPlan",
    label: "今日の予定",
    description: "一日の流れを午前・午後・夜のざっくり3つに分けて書きます",
    text: "今日の予定\n午前: \n午後: \n夜: \n忘れずに: ",
  },
  {
    id: "meetingNote",
    label: "打ち合わせメモ",
    description: "話したこと・決まったこと・次にやることを1枚にまとめます",
    text: "打ち合わせメモ\n日付: \n参加者: \n決まったこと: \nやること: \n次回: ",
  },
  {
    id: "outline",
    label: "考えをまとめる",
    description: "ひとつのテーマを3つの要点に分けて、考えを整理します",
    text: "テーマ: \n要点1: \n要点2: \n要点3: \nまとめ: ",
  },
];

/** ユーザーが作成したテンプレートも含めた全一覧（templatePicker.tsの選択画面に
 *  出す並び順そのもの）。保存済みのユーザー作成分は毎回localStorageから読み直す
 *  ——このモジュールの外（templatePicker.ts）でしか増減しないため、キャッシュは持たない。 */
export function getAllTemplates(): TemplateDef[] {
  return [...TEMPLATES, ...loadCustomTemplates()];
}

export function getTemplateText(id: TemplateId): string {
  return getAllTemplates().find((t) => t.id === id)?.text ?? TEMPLATES[0].text;
}

/**
 * 見出しと1つ以上のテーマ（テーマ1は必須、2つ目以降は任意）から、組み込みテンプレート
 * と同じ見た目のテンプレートを作って保存する。各テーマは組み込みテンプレートの各項目
 * （「日時: 」など）と同じ形——コロン+空白で終え、内容は空欄のまま盤面に置いた後で
 * テキスト道具で書き込む。
 */
export function createCustomTemplate(heading: string, themes: string[]): TemplateDef {
  const label = heading.trim();
  const lines = [label, ...themes.map((theme) => `${theme.trim()}: `)];
  const tpl: TemplateDef = {
    id: `${CUSTOM_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    description: "自分で作成したテンプレート",
    text: lines.join("\n"),
  };
  saveCustomTemplates([...loadCustomTemplates(), tpl]);
  return tpl;
}

/** 組み込みではなくユーザーが作成したテンプレートかどうか。テンプレート選択画面
 *  （templatePicker.ts）が、削除ボタンを出すかどうかの判断に使う。 */
export function isCustomTemplateId(id: TemplateId): boolean {
  return id.startsWith(CUSTOM_ID_PREFIX);
}

export function deleteCustomTemplate(id: TemplateId): void {
  saveCustomTemplates(loadCustomTemplates().filter((t) => t.id !== id));
}
