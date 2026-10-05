import type { GenerationRequest, StampCount, StampPlanItem, StampTemplate, StampTheme } from "../types/index";

type Template = readonly [string, string, string, string];

const daily: Template[] = [
  ["おはよう", "少し眠そう", "伸びをする", "小さな朝日"],
  ["こんにちは", "明るい笑顔", "片方の前足で挨拶する", ""],
  ["こんばんは", "穏やか", "軽く会釈する", "三日月"],
  ["おやすみ", "安心して眠る", "丸くなって枕に頭をのせる", "枕"],
  ["いってきます", "元気", "バッグを持って出発する", "バッグ"],
  ["いってらっしゃい", "温かい笑顔", "高く前足を上げて見送る", ""],
  ["ただいま", "ほっとした表情", "バッグを下ろして帰宅する", "バッグ"],
  ["おかえり", "嬉しそう", "両前足を広げて迎える", ""],
  ["ありがとう", "感謝の笑顔", "深くお辞儀する", "花束"],
  ["どういたしまして", "照れ笑い", "胸に前足を当てる", ""],
  ["ごめんね", "申し訳なさそう", "頭を下げる", ""],
  ["大丈夫", "安心した笑顔", "親指を立てる", ""],
  ["またね", "名残惜しそう", "振り返って手を振る", ""],
  ["おつかれさま", "優しい笑顔", "飲み物を差し出す", "湯のみ"],
  ["おめでとう", "満面の笑顔", "飛び跳ねて祝う", "紙吹雪"],
  ["よろしくね", "期待した笑顔", "握手を求める", ""],
  ["うれしい", "目を輝かせる", "両手を上げる", ""],
  ["かなしい", "涙ぐむ", "うつむく", "ハンカチ"],
  ["びっくり", "目を丸くする", "後ろに飛びのく", ""],
  ["やったー", "得意げ", "ガッツポーズをする", ""],
  ["がんばって", "励ます笑顔", "拳を握って応援する", "旗"],
  ["おねがい", "切実な表情", "前足を合わせる", ""],
  ["了解", "きりっとした表情", "敬礼する", ""],
  ["ちょっと待って", "慌てた表情", "片手を前に出す", "時計"],
  ["今向かってる", "急いだ表情", "走り出す", "バッグ"],
  ["着いたよ", "ほっとした笑顔", "到着を知らせる", "目印の旗"],
  ["おなかすいた", "期待した表情", "お腹をさする", "スプーン"],
  ["いただきます", "わくわく", "手を合わせる", "食卓"],
  ["ごちそうさま", "満足げ", "お腹をぽんと叩く", "お皿"],
  ["お茶しよう", "誘う笑顔", "席をすすめる", "ティーカップ"],
  ["ゆっくり休んで", "いたわる表情", "毛布をかける", "毛布"],
  ["お大事に", "心配そう", "薬を差し出す", "薬箱"],
  ["元気？", "気遣う表情", "顔をのぞき込む", ""],
  ["会いたい", "寂しそう", "両前足を伸ばす", ""],
  ["楽しかった", "満足した笑顔", "思い出を抱える", "写真"],
  ["いいね", "賛成の笑顔", "拍手する", ""],
  ["すごい", "感心した表情", "目を輝かせて拍手する", "星"],
  ["無理しないで", "心配そう", "そっと肩をたたく", ""],
  ["また明日", "穏やかな笑顔", "夕空に手を振る", "夕日"],
  ["おやつの時間", "楽しそう", "お菓子を持ち上げる", "クッキー"],
];

const work: Template[] = [
  ["おはようございます", "明るい笑顔", "丁寧に会釈する", ""],
  ["お疲れさまです", "ねぎらう笑顔", "飲み物を差し出す", "コーヒー"],
  ["よろしくお願いします", "真剣な表情", "深くお辞儀する", ""],
  ["承知しました", "落ち着いた表情", "メモを取る", "手帳"],
  ["確認します", "集中した表情", "書類を読む", "書類"],
  ["確認しました", "確信した笑顔", "書類に丸をつける", "ペン"],
  ["ありがとうございます", "感謝の笑顔", "丁寧に頭を下げる", ""],
  ["申し訳ありません", "反省した表情", "深く頭を下げる", ""],
  ["少々お待ちください", "丁寧な表情", "時計を示す", "時計"],
  ["すぐ対応します", "頼もしい表情", "作業に取りかかる", "ノートパソコン"],
  ["対応中です", "集中した表情", "キーボードを打つ", "ノートパソコン"],
  ["対応完了しました", "達成感", "完了印を押す", "スタンプ台"],
  ["資料を送ります", "親切な笑顔", "封筒を差し出す", "封筒"],
  ["受け取りました", "安心した笑顔", "書類を受け取る", "ファイル"],
  ["拝見します", "丁寧な表情", "書類を開く", "書類"],
  ["ご確認ください", "真剣な表情", "資料を指し示す", "資料"],
  ["問題ありません", "安心した笑顔", "丸の札を掲げる", "丸の札"],
  ["修正します", "前向きな表情", "赤ペンを取る", "赤ペン"],
  ["再送します", "申し訳なさそう", "封筒を持って急ぐ", "封筒"],
  ["相談があります", "控えめな表情", "声をかける", "メモ"],
  ["ご意見ください", "期待した表情", "ノートを開いて待つ", "ノート"],
  ["助かります", "感謝した表情", "胸に手を当てる", ""],
  ["お任せください", "自信のある表情", "胸を張る", ""],
  ["進捗を共有します", "落ち着いた表情", "進捗表を示す", "進捗表"],
  ["会議を始めます", "きりっとした表情", "ホワイトボードを指す", "ホワイトボード"],
  ["会議中です", "集中した表情", "着席して話を聞く", "ノート"],
  ["後ほど連絡します", "丁寧な笑顔", "電話を示す", "電話"],
  ["折り返します", "急いだ表情", "電話を取る", "電話"],
  ["本日中に対応します", "決意した表情", "腕まくりする", "時計"],
  ["明日対応します", "落ち着いた表情", "予定表に印をつける", "カレンダー"],
  ["遅れます", "焦った表情", "走りながら知らせる", "時計"],
  ["先に失礼します", "申し訳なさそう", "退室時に会釈する", "バッグ"],
  ["休憩します", "ほっとした表情", "椅子にもたれる", "マグカップ"],
  ["戻りました", "すっきりした表情", "席に戻って挨拶する", ""],
  ["お先にどうぞ", "親切な笑顔", "道を譲る", ""],
  ["お待たせしました", "申し訳なさそう", "資料を持って戻る", "資料"],
  ["ご協力お願いします", "真摯な表情", "両手を合わせる", ""],
  ["ご協力感謝します", "感激した表情", "拍手して感謝する", ""],
  ["おめでとうございます", "嬉しい笑顔", "拍手して祝う", "花束"],
  ["引き続きよろしくお願いします", "穏やかな笑顔", "握手する", ""],
];

export const STAMP_TEMPLATE_CATALOG_SIZE = 40;

function toTemplate(theme: StampTheme, [meaning, expression, pose, prop]: Template, index: number): StampTemplate {
  // テンプレートIDはテーマを含むため、テーマ内／テーマ間で一意。カタログ番号は1始まりで生成位置とは別。
  return Object.freeze({ id: `${theme}-t${String(index + 1).padStart(2, "0")}`, theme, catalogNumber: index + 1, meaning, expression, pose, prop });
}

const catalogs: Record<StampTheme, readonly StampTemplate[]> = {
  daily: Object.freeze(daily.map((template, index) => toTemplate("daily", template, index))),
  work: Object.freeze(work.map((template, index) => toTemplate("work", template, index))),
};
const templatesById = new Map<string, StampTemplate>(
  [...catalogs.daily, ...catalogs.work].map((template) => [template.id, template]),
);

/** テーマのテンプレートカタログ（40件・元の順序）を返す。生成企画とは別のデータ。 */
export function getStampTemplateCatalog(theme: StampTheme): readonly StampTemplate[] {
  return catalogs[theme];
}

/** テンプレートIDからカタログ項目を引く。テーマを指定した場合は別テーマのIDを拒否する。 */
export function findStampTemplate(id: string | undefined, theme?: StampTheme): StampTemplate | undefined {
  const template = id === undefined ? undefined : templatesById.get(id);
  return template && (theme === undefined || template.theme === theme) ? template : undefined;
}

/** テンプレート由来の生成項目ID。選択解除・再選択・画面往復・再生成で変わらない。 */
export function templatePlanItemId(templateId: string): string {
  return `plan-${templateId}`;
}

/** テンプレートから新規の生成項目を作る。文字設定は新規企画と同じtrue/null。 */
export function createPlanItemFromTemplate(template: StampTemplate, position: number): StampPlanItem {
  return {
    id: templatePlanItemId(template.id), position, sourceTemplateId: template.id,
    meaning: template.meaning, expression: template.expression, pose: template.pose, prop: template.prop,
    textEnabled: true, displayText: null,
  };
}

/** 選択済み項目の位置を生成セット内の0～N-1へ振り直す（カタログ番号は使わない）。 */
export function renumberPlanItems(items: readonly StampPlanItem[]): StampPlanItem[] {
  return items.map((item, position) => item.position === position ? item : { ...item, position });
}

/** 初期選択（カタログ先頭N件）の生成企画。 */
export function createStampPlan(theme: StampTheme, count: StampCount): StampPlanItem[] {
  return getStampTemplateCatalog(theme).slice(0, count).map(createPlanItemFromTemplate);
}

/** 選択中の項目（items・生成順）と、選択解除したが編集内容を保持する作業中下書き（drafts）。 */
export interface PlanSelection {
  items: StampPlanItem[];
  drafts: StampPlanItem[];
}
export interface PlanSelectionResult {
  selection: PlanSelection;
  error: string | null;
}

/** テンプレート由来の項目か（テーマが一致する有効なsourceTemplateIdを持つか）。 */
export function templateOf(item: StampPlanItem, theme: StampTheme): StampTemplate | undefined {
  return findStampTemplate(item.sourceTemplateId, theme);
}

function withoutItem(items: readonly StampPlanItem[], id: string): StampPlanItem[] {
  return items.filter((item) => item.id !== id);
}

/** 既存の並びを保ち、カタログ順の位置へ新しいテンプレート項目を挿入する（選択した順にはしない）。 */
function insertByCatalogOrder(items: readonly StampPlanItem[], item: StampPlanItem, theme: StampTheme): StampPlanItem[] {
  const number = templateOf(item, theme)?.catalogNumber ?? Number.POSITIVE_INFINITY;
  const index = items.findIndex((current) => (templateOf(current, theme)?.catalogNumber ?? -1) > number);
  return index < 0 ? [...items, item] : [...items.slice(0, index), item, ...items.slice(index)];
}

function uniqueId(base: string, used: readonly StampPlanItem[]): string {
  let id = base;
  for (let suffix = 2; used.some((item) => item.id === id); suffix += 1) id = `${base}-${suffix}`;
  return id;
}

function limitMessage(count: number): string {
  return `選択できるのは${count}件までです。入れ替える場合は、先にほかの項目のチェックを外してください。`;
}

/** テンプレートを選択する。上限到達時は他の項目を外さず、案内を返して状態を変えない。 */
export function selectTemplate(theme: StampTheme, count: number, selection: PlanSelection, templateId: string): PlanSelectionResult {
  const template = findStampTemplate(templateId, theme);
  if (!template) return { selection, error: "選択できないテンプレートです。" };
  if (selection.items.some((item) => item.sourceTemplateId === templateId)) return { selection, error: null };
  if (selection.items.length >= count) return { selection, error: limitMessage(count) };
  const draft = selection.drafts.find((item) => item.sourceTemplateId === templateId);
  let restored = draft;
  if (!restored) {
    const created = createPlanItemFromTemplate(template, 0);
    restored = { ...created, id: uniqueId(created.id, [...selection.items, ...selection.drafts]) };
  }
  return {
    selection: {
      items: renumberPlanItems(insertByCatalogOrder(selection.items, restored, theme)),
      drafts: draft ? withoutItem(selection.drafts, draft.id) : selection.drafts,
    },
    error: null,
  };
}

/** 下書きに残したカスタム企画（テンプレート由来でない項目）を再選択する。末尾に追加する。 */
export function selectDraftItem(count: number, selection: PlanSelection, itemId: string): PlanSelectionResult {
  const draft = selection.drafts.find((item) => item.id === itemId);
  if (!draft) return { selection, error: "選択できない項目です。" };
  if (selection.items.length >= count) return { selection, error: limitMessage(count) };
  return { selection: { items: renumberPlanItems([...selection.items, draft]), drafts: withoutItem(selection.drafts, itemId) }, error: null };
}

/** 選択を外す。編集内容は作業中下書きとして保持し、ほかの選択項目は変更しない。 */
export function deselectPlanItem(selection: PlanSelection, itemId: string): PlanSelection {
  const item = selection.items.find((current) => current.id === itemId);
  if (!item) return selection;
  return { items: renumberPlanItems(withoutItem(selection.items, itemId)), drafts: [...withoutItem(selection.drafts, itemId), item] };
}

/** すべて選択解除する（編集内容は下書きに保持）。 */
export function clearPlanSelection(selection: PlanSelection): PlanSelection {
  const ids = new Set(selection.items.map((item) => item.id));
  return { items: [], drafts: [...selection.drafts.filter((item) => !ids.has(item.id)), ...selection.items] };
}

/** 「先頭N件に戻す」。継続して選ばれる項目の編集は保持し、外れた項目は下書きへ移す。 */
export function resetPlanSelection(theme: StampTheme, count: number, selection: PlanSelection): PlanSelection {
  const pool = [...selection.items, ...selection.drafts];
  const chosen: StampPlanItem[] = [];
  for (const template of getStampTemplateCatalog(theme).slice(0, count)) {
    const existing = pool.find((item) => item.sourceTemplateId === template.id);
    if (existing) { chosen.push(existing); continue; }
    const created = createPlanItemFromTemplate(template, 0);
    chosen.push({ ...created, id: uniqueId(created.id, [...pool, ...chosen]) });
  }
  const chosenIds = new Set(chosen.map((item) => item.id));
  return { items: renumberPlanItems(chosen), drafts: pool.filter((item) => !chosenIds.has(item.id)) };
}

/** 未選択のテンプレートをカタログ順で追加し、count件まで埋める（40枚で全件を選ぶ用途）。 */
export function fillPlanSelection(theme: StampTheme, count: number, selection: PlanSelection): PlanSelection {
  let next = selection;
  for (const template of getStampTemplateCatalog(theme)) {
    if (next.items.length >= count) break;
    next = selectTemplate(theme, count, next, template.id).selection;
  }
  return next;
}

export interface PlanSelectionStatus {
  selected: number;
  required: number;
  shortage: number;
  excess: number;
  complete: boolean;
}

export function getPlanSelectionStatus(count: number, items: readonly StampPlanItem[]): PlanSelectionStatus {
  const selected = items.length;
  return { selected, required: count, shortage: Math.max(0, count - selected), excess: Math.max(0, selected - count), complete: selected === count };
}

/** テンプレートの初期値から編集されているか。テンプレート由来でない項目はカスタムとして編集扱い。 */
export function isPlanItemEdited(item: StampPlanItem, theme: StampTheme): boolean {
  const template = templateOf(item, theme);
  if (!template) return true;
  return item.meaning !== template.meaning || item.expression !== template.expression || item.pose !== template.pose ||
    item.prop !== template.prop || (item.additionalInstructions ?? "") !== "" ||
    (item.textEnabled ?? false) !== true || (item.displayText ?? null) !== null;
}

/** テーマ変更で失われる作業（初期選択からの変更・編集）があるか。 */
export function hasPlanSelectionWork(theme: StampTheme, count: number, selection: PlanSelection): boolean {
  const defaults = getStampTemplateCatalog(theme).slice(0, count).map((template) => template.id);
  const selected = selection.items.map((item) => item.sourceTemplateId);
  return selected.length !== defaults.length || selected.some((id, index) => id !== defaults[index]) ||
    [...selection.items, ...selection.drafts].some((item) => isPlanItemEdited(item, theme));
}

/**
 * 保存データ等の項目を照合する。テーマのカタログに存在しない・重複したsourceTemplateIdは外して
 * カスタム企画として保持する（意味が似ていても別のテンプレートへ紐付けない）。
 */
export function reconcilePlanItems(theme: StampTheme, items: readonly StampPlanItem[]): StampPlanItem[] {
  const seen = new Set<string>();
  return items.map((item) => {
    const id = item.sourceTemplateId;
    if (id === undefined) return item;
    if (findStampTemplate(id, theme) && !seen.has(id)) { seen.add(id); return item; }
    const { sourceTemplateId: _removed, ...custom } = item;
    return custom;
  });
}

export function normalizeStampPlanItem(item: StampPlanItem): StampPlanItem {
  return { ...item, textEnabled: item.textEnabled ?? false, displayText: item.displayText ?? null };
}

export function resolveDisplayText(item: StampPlanItem): string {
  return (item.displayText ?? item.meaning).trim();
}

export function validateStampPlan(request: GenerationRequest): string[] {
  const items = request.items ?? [];
  const errors: string[] = [];
  if (items.length !== request.count) errors.push("企画の件数がスタンプ枚数と一致しません。");
  const meanings = new Set<string>();
  const ids = new Set<string>();
  const templateIds = new Set<string>();
  items.forEach((item, position) => {
    if (item.position !== position || !item.id || ids.has(item.id)) errors.push(`${position + 1}件目のIDまたは位置が不正です。`);
    ids.add(item.id);
    if (item.sourceTemplateId !== undefined) {
      // カタログIDは由来の記録だけに使う。別テーマ・未知のID・同じテンプレートの重複選択を拒否する。
      // テーマ未指定の部分検証（レビュー時のフォーム等）では、いずれかのカタログに存在することを確認する。
      if (!findStampTemplate(item.sourceTemplateId, request.theme)) errors.push(`${position + 1}件目のテンプレートIDが不正です。`);
      else if (templateIds.has(item.sourceTemplateId)) errors.push(`${position + 1}件目のテンプレートが重複して選択されています。`);
      templateIds.add(item.sourceTemplateId);
    }
    if (item.textEnabled !== undefined && typeof item.textEnabled !== "boolean") errors.push(`${position + 1}件目の文字設定が不正です。`);
    if (item.displayText != null && typeof item.displayText !== "string") {
      errors.push(`${position + 1}件目の表示文字が不正です。`);
    } else {
      if (item.displayText != null && Array.from(item.displayText).length > 100) errors.push(`${position + 1}件目の表示文字は100文字以内にしてください。`);
      if (item.textEnabled && !resolveDisplayText(item)) errors.push(`${position + 1}件目の画像に描く文字を入力してください。`);
    }
    for (const field of ["meaning", "expression", "pose"] as const) {
      const value = item[field].trim();
      const label = { meaning: "伝えたい言葉／意味", expression: "表情", pose: "ポーズ" }[field];
      if (!value || value.length > 100) errors.push(`${position + 1}件目の${label}は1～100文字で入力してください。`);
    }
    if (item.prop.trim().length > 100) errors.push(`${position + 1}件目の小物は100文字以内にしてください。`);
    if ((item.additionalInstructions ?? "").length > 500) errors.push(`${position + 1}件目の追加の指示は500文字以内にしてください。`);
    const meaning = item.meaning.trim();
    if (meaning && meanings.has(meaning)) errors.push(`「${meaning}」が重複しています。`);
    meanings.add(meaning);
  });
  return errors;
}
