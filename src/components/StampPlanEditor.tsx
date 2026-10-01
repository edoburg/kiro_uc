import React, { useState } from "react";
import type { GenerationRequest, StampPlanItem } from "../types/index";
import { validateStampPlan } from "../utils/stampPlan";

interface Props {
  request: GenerationRequest;
  onBack: () => void;
  onGenerate: (request: GenerationRequest) => void;
  onItemsChange?: (items: StampPlanItem[]) => void;
}

const StampPlanEditor: React.FC<Props> = ({ request, onBack, onGenerate, onItemsChange }) => {
  const [items, setItems] = useState<StampPlanItem[]>(() => request.items ?? []);
  const [attempted, setAttempted] = useState(false);
  const errors = validateStampPlan({ ...request, items });
  const update = (position: number, field: "meaning" | "expression" | "pose" | "prop", value: string): void => {
    const next = items.map((item) => item.position === position ? { ...item, [field]: value } : item);
    setItems(next);
    onItemsChange?.(next);
  };
  return <section className="stamp-plan-editor" aria-label="スタンプ内容の企画">
    <h2>スタンプ内容を確認・編集</h2>
    <p>全{request.count}枚の内容です。意味は画像内の文字ではなく、表情やポーズで表します。画像生成は「画像を生成」を押してから始まります。</p>
    {items.map((item) => <fieldset key={item.id} className="stamp-plan-editor__item">
      <legend>{item.position + 1}枚目</legend>
      {([ ["meaning", "伝えたい言葉／意味"], ["expression", "表情"], ["pose", "ポーズ"], ["prop", "小物（任意）"] ] as const).map(([field, label]) =>
        <label key={field}>{label}<input value={item[field]} maxLength={100} onChange={(event) => update(item.position, field, event.target.value)} /></label>)}
    </fieldset>)}
    {attempted && errors.length > 0 && <div role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    <button type="button" onClick={onBack}>共通設定に戻る</button>
    <button type="button" onClick={() => { setAttempted(true); if (errors.length === 0) onGenerate({ ...request, items: items.map((item) => ({ ...item })) }); }}>画像を生成</button>
  </section>;
};

export default StampPlanEditor;
