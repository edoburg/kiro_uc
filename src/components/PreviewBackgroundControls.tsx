import { usePreviewBackground } from "../stores/previewBackgroundStore";
import type { PreviewBackground } from "../types";

export default function PreviewBackgroundControls() {
  const { background, customColor, setBackground, setCustomColor } = usePreviewBackground();
  return <div className="preview-background-controls">
    <label>表示背景
      <select aria-label="表示背景" value={background} onChange={(event) => setBackground(event.target.value as PreviewBackground)}>
        <option value="checker">市松模様</option><option value="white">白</option>
        <option value="black">黒</option><option value="gray">薄いグレー</option><option value="custom">任意色</option>
      </select>
    </label>
    {background === "custom" && <label>任意の背景色<input type="color" value={customColor} onChange={(event) => setCustomColor(event.target.value)} /></label>}
    <p>背景色を変えて透過を確認してください。白・黒でも格子が残る場合、市松模様は画像に描かれています。表示背景は出力PNGに含まれません。</p>
  </div>;
}
