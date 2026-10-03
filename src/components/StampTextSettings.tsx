import React from "react";
import type { StampPlanItem } from "../types/index";
import { resolveDisplayText } from "../utils/stampPlan";

interface Props {
  item: StampPlanItem;
  onChange: (settings: Pick<StampPlanItem, "textEnabled" | "displayText">) => void;
}

const StampTextSettings: React.FC<Props> = ({ item, onChange }) => <div className="stamp-text-settings">
  <label><input type="checkbox" checked={item.textEnabled ?? false}
    onChange={(event) => onChange({ textEnabled: event.target.checked })} />文字を入れる</label>
  <label>画像に描く文字<input value={item.displayText ?? resolveDisplayText(item)} disabled={!item.textEnabled}
    onChange={(event) => onChange({ displayText: event.target.value })} /></label>
  <span>{item.displayText == null ? "意味を使用" : "任意文字（100文字以内）"}</span>
  <button type="button" disabled={!item.textEnabled || item.displayText == null}
    onClick={() => onChange({ displayText: null })}>意味を使用に戻す</button>
</div>;

export default StampTextSettings;
