import type { ImgHTMLAttributes } from "react";
import { usePreviewBackground } from "../stores/previewBackgroundStore";

export default function PreviewImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const { background, customColor } = usePreviewBackground();
  const color = { checker: "#ffffff", white: "#ffffff", black: "#000000", gray: "#eeeeee", custom: customColor }[background];
  return <div className={`preview-surface${background === "checker" ? " preview-surface--checker" : ""}`} style={{ backgroundColor: color }}><img {...props} /></div>;
}
