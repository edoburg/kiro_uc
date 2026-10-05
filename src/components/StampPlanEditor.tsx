import React, { useId, useState } from "react";
import type { GenerationRequest, StampPlanItem } from "../types/index";
import { normalizeStampPlanItem, templateOf, validateStampPlan } from "../utils/stampPlan";
import StampTextSettings from "./StampTextSettings";

interface Props {
  request: GenerationRequest;
  onBack: () => void;
  /** 項目の選択画面へ戻る。選択と編集内容は保持される。 */
  onBackToSelection?: () => void;
  onGenerate: (request: GenerationRequest) => void;
  onItemsChange?: (items: StampPlanItem[]) => void;
}

const StampPlanEditor: React.FC<Props> = ({ request, onBack, onBackToSelection, onGenerate, onItemsChange }) => {
  const [items, setItems] = useState<StampPlanItem[]>(() => (request.items ?? []).map(normalizeStampPlanItem));
  const [attempted, setAttempted] = useState(false);
  const errors = validateStampPlan({ ...request, items });
  const theme = request.theme ?? "daily";
  const idPrefix = useId();
  const update = (position: number, field: "meaning" | "expression" | "pose" | "prop", value: string): void => {
    const next = items.map((item) => item.position === position ? { ...item, [field]: value } : item);
    setItems(next);
    onItemsChange?.(next);
  };
  return <section className="stamp-plan-editor" aria-label="スタンプ内容の企画">
    <h2>スタンプ内容を確認・編集</h2>
    <p>選択した全{request.count}枚の内容です。画像生成は「画像を生成」を押してから始まります。生成順はこの一覧の順（1枚目から）です。</p>
    <p>文字はAIが手書き風に描きます。誤字や読みやすさは生成後に確認してください。文字設定は共通設定・追加指示より優先されます。</p>
    {items.map((item) => {
      const template = templateOf(item, theme);
      const titleId = `${idPrefix}-${item.id}-title`;
      const sourceId = `${idPrefix}-${item.id}-source`;
      // 由来の表示は見出し（legend）内に置き、入力欄のグリッドを崩さない。グループ名は「n枚目」のまま。
      return <fieldset key={item.id} className="stamp-plan-editor__item" aria-labelledby={titleId} aria-describedby={sourceId}>
        <legend>
          <span id={titleId}>{item.position + 1}枚目</span>
          <span id={sourceId} className="stamp-plan-editor__source">{template ? `元のテンプレート：No.${template.catalogNumber}「${template.meaning}」` : "カスタム企画（テンプレートに紐付きません）"}</span>
        </legend>
        {([ ["meaning", "伝えたい言葉／意味"], ["expression", "表情"], ["pose", "ポーズ"], ["prop", "小物（任意）"] ] as const).map(([field, label]) =>
          <label key={field}>{label}<input value={item[field]} maxLength={100} onChange={(event) => update(item.position, field, event.target.value)} /></label>)}
        <StampTextSettings item={item} onChange={(settings) => {
          const next = items.map((current) => current.id === item.id ? { ...current, ...settings } : current);
          setItems(next); onItemsChange?.(next);
        }} />
        <label className="stamp-plan-editor__instructions">追加の指示（任意・500文字以内）<textarea rows={3} maxLength={500} value={item.additionalInstructions ?? ""} onChange={(event) => {
          const next = items.map((current) => current.id === item.id ? { ...current, additionalInstructions: event.target.value } : current);
          setItems(next); onItemsChange?.(next);
        }} /></label>
      </fieldset>;
    })}
    {attempted && errors.length > 0 && <div role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    {onBackToSelection && <button type="button" onClick={onBackToSelection}>項目の選択に戻る</button>}
    <button type="button" onClick={onBack}>共通設定に戻る</button>
    <button type="button" onClick={() => { setAttempted(true); if (errors.length === 0) onGenerate({ ...request, items: items.map((item) => ({ ...item })) }); }}>画像を生成</button>
  </section>;
};

export default StampPlanEditor;
