import React, { useId, useState } from "react";
import type { GenerationRequest, StampPlanItem } from "../types/index";
import {
  clearPlanSelection,
  deselectPlanItem,
  getPlanSelectionStatus,
  getStampTemplateCatalog,
  isPlanItemEdited,
  resetPlanSelection,
  selectDraftItem,
  selectTemplate,
  templateOf,
  type PlanSelection,
} from "../utils/stampPlan";

interface Props {
  request: GenerationRequest;
  /** 選択を外した項目の作業中下書き（編集内容の保持用）。 */
  drafts: StampPlanItem[];
  /** 生成中など、選択を変更できないとき true。 */
  locked?: boolean;
  onChange: (selection: PlanSelection) => void;
  onBack: () => void;
  onNext: () => void;
}

const THEME_LABEL = { daily: "日常の挨拶", work: "仕事で使う言葉" } as const;

/**
 * テーマのテンプレート40件から、生成する項目をチェックで選ぶ画面。
 * 選択数がスタンプ枚数と一致したときだけ企画編集へ進める。上限超過時は他の項目を黙って外さない。
 */
const StampTemplateSelector: React.FC<Props> = ({ request, drafts, locked = false, onChange, onBack, onNext }) => {
  const theme = request.theme ?? "daily";
  const count = request.count;
  const items = request.items ?? [];
  const selection: PlanSelection = { items, drafts };
  const status = getPlanSelectionStatus(count, items);
  const [message, setMessage] = useState<string | null>(null);
  const statusId = useId();
  const catalog = getStampTemplateCatalog(theme);
  const customItems = [...items, ...drafts].filter((item) => !templateOf(item, theme));

  const apply = (next: PlanSelection, error: string | null = null): void => {
    setMessage(error);
    if (!error) onChange(next);
  };
  const toggleTemplate = (templateId: string, checked: boolean): void => {
    if (locked) return;
    if (checked) {
      const result = selectTemplate(theme, count, selection, templateId);
      apply(result.selection, result.error);
    } else {
      const item = items.find((current) => current.sourceTemplateId === templateId);
      if (item) apply(deselectPlanItem(selection, item.id));
    }
  };
  const toggleCustom = (itemId: string, checked: boolean): void => {
    if (locked) return;
    if (checked) {
      const result = selectDraftItem(count, selection, itemId);
      apply(result.selection, result.error);
    } else apply(deselectPlanItem(selection, itemId));
  };

  const guidance = status.shortage > 0
    ? `あと${status.shortage}件選んでください。`
    : status.excess > 0
      ? `${status.excess}件多く選択しています。${status.excess}件のチェックを外してください。`
      : "選択数がスタンプ枚数と一致しました。";

  return <section className="stamp-template-selector" aria-label="生成する項目の選択">
    <h2>生成する項目を選択（{THEME_LABEL[theme]}・全{catalog.length}件）</h2>
    <p>スタンプ{count}枚分の項目を{catalog.length}件から選びます。生成順は選んだ順ではなく、テンプレートの番号順です（保存した設定を読み込んだ場合は保存時の並び順を保ちます）。言葉／意味・表情・ポーズ・小物・文字設定は次の企画編集で変更できます。</p>
    <p>上限まで選んだ状態で別の項目に入れ替える場合は、先に外したい項目のチェックを外してください。選択を外した項目の編集内容は、この作業中は保持されます。</p>
    <div className="stamp-template-selector__status" id={statusId} aria-live="polite">
      <strong>選択中{status.selected}／{count}件</strong> {guidance}
    </div>
    {message && <p className="stamp-template-selector__error" role="alert">{message}</p>}
    <div className="stamp-template-selector__actions">
      <button type="button" disabled={locked} onClick={() => apply(resetPlanSelection(theme, count, selection))}>先頭{count}件に戻す</button>
      <button type="button" disabled={locked || items.length === 0} onClick={() => apply(clearPlanSelection(selection))}>選択を解除</button>
    </div>
    <ol className="stamp-template-selector__list" aria-label="テンプレート一覧">
      {catalog.map((template) => {
        const selected = items.find((item) => item.sourceTemplateId === template.id);
        const edited = selected ?? drafts.find((item) => item.sourceTemplateId === template.id);
        const isEdited = edited ? isPlanItemEdited(edited, theme) : false;
        return <li key={template.id} className={selected ? "is-selected" : undefined}>
          <label>
            <input type="checkbox" checked={selected !== undefined} disabled={locked}
              aria-describedby={statusId}
              onChange={(event) => toggleTemplate(template.id, event.target.checked)} />
            <span className="stamp-template-selector__number">No.{template.catalogNumber}</span>{" "}
            <span className="stamp-template-selector__meaning">{template.meaning}</span>
          </label>
          <span className="stamp-template-selector__detail">表情：{template.expression}／ポーズ：{template.pose}／小物：{template.prop || "なし"}</span>
          {selected && <span className="stamp-template-selector__order">生成順 {selected.position + 1}枚目</span>}
          {isEdited && edited && <span className="stamp-template-selector__edited">編集済み（{edited.meaning}）</span>}
        </li>;
      })}
    </ol>
    {customItems.length > 0 && <fieldset className="stamp-template-selector__custom">
      <legend>カスタム企画（テンプレートに紐付かない保存済み項目）</legend>
      <ul>
        {customItems.map((item) => {
          const selected = items.some((current) => current.id === item.id);
          return <li key={item.id}>
            <label>
              <input type="checkbox" checked={selected} disabled={locked} aria-describedby={statusId}
                onChange={(event) => toggleCustom(item.id, event.target.checked)} />
              {item.meaning || "（意味未入力）"}
            </label>
            <span className="stamp-template-selector__detail">表情：{item.expression}／ポーズ：{item.pose}／小物：{item.prop || "なし"}</span>
            {selected && <span className="stamp-template-selector__order">生成順 {item.position + 1}枚目</span>}
          </li>;
        })}
      </ul>
    </fieldset>}
    <div className="stamp-template-selector__actions">
      <button type="button" onClick={onBack}>共通設定に戻る</button>
      <button type="button" disabled={locked || !status.complete} aria-describedby={statusId} onClick={() => { if (status.complete && !locked) onNext(); }}>企画の編集へ進む</button>
    </div>
  </section>;
};

export default StampTemplateSelector;
