import React, { useState } from "react";
import type { StampPlanItem } from "../types/index";
import { validateStampPlan } from "../utils/stampPlan";

interface Props {
  item: StampPlanItem;
  items: StampPlanItem[];
  onCancel: () => void;
  onConfirm: (item: StampPlanItem) => void;
}

/** レビュー中の1枚に対する編集ドラフト。確定までは企画を変更しない。 */
const RegenerationEditor: React.FC<Props> = ({ item, items, onCancel, onConfirm }) => {
  const [draft, setDraft] = useState(() => ({
    meaning: item.meaning,
    expression: item.expression,
    pose: item.pose,
    prop: item.prop,
    additionalInstructions: item.additionalInstructions ?? "",
  }));
  const [attempted, setAttempted] = useState(false);
  const candidate: StampPlanItem = { ...item, ...draft };
  const errors = validateStampPlan({
    prompt: "review",
    count: items.length as 8 | 16 | 24 | 32 | 40,
    mode: "batch",
    items: items.map((current) => current.id === item.id ? candidate : current),
  });

  const update = (field: keyof typeof draft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    setAttempted(true);
    if (errors.length === 0) onConfirm(candidate);
  };

  return <form className="regeneration-editor" aria-label={`${item.meaning}の再生成条件`} onSubmit={submit} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
  }} noValidate>
    <p>この1枚の条件を編集します。共通のキャラクター設定と画風は維持されます。</p>
    <label>伝えたい言葉／意味
      <input autoFocus value={draft.meaning} maxLength={100} onChange={(event) => update("meaning", event.target.value)} />
    </label>
    <label>表情
      <input value={draft.expression} maxLength={100} onChange={(event) => update("expression", event.target.value)} />
    </label>
    <label>ポーズ
      <input value={draft.pose} maxLength={100} onChange={(event) => update("pose", event.target.value)} />
    </label>
    <label>小物（任意）
      <input value={draft.prop} maxLength={100} onChange={(event) => update("prop", event.target.value)} />
    </label>
    <label>追加の指示（任意・500文字以内）
      <textarea value={draft.additionalInstructions} maxLength={500} rows={3} placeholder="例: 中央下寄りに配置し、顔を隠さない" onChange={(event) => update("additionalInstructions", event.target.value)} />
    </label>
    {attempted && errors.length > 0 && <div role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    <div className="regeneration-editor__actions">
      <button type="button" onClick={onCancel}>キャンセル</button>
      <button type="submit">この内容で再生成</button>
    </div>
  </form>;
};

export default RegenerationEditor;
