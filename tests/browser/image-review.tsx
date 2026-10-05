import React from "react";
import { createRoot } from "react-dom/client";
import ImagePreviewGrid from "../../src/components/ImagePreviewGrid";
import { createStampPlan } from "../../src/utils/stampPlan";
import "../../src/styles.css";

const fixtures: string[] = await fetch("/.pytest_cache/image-review/fixtures.json").then((response) => response.json());
const items = createStampPlan("daily", 8);
const root = document.getElementById("root")!;
const style = document.createElement("style");
style.textContent = ".preview-grid{grid-template-columns:repeat(auto-fill,160px)} .preview-image{height:128px;object-fit:contain;image-rendering:pixelated} .image-review-image{image-rendering:pixelated}";
document.head.appendChild(style);
createRoot(root).render(<ImagePreviewGrid items={items} images={fixtures.map((dataUrl, index) => ({ index, itemId: items[index].id, dataUrl, tempFilePath: `fixture-${index}.png`, status: "done" }))} mode="batch" totalCount={8} onDelete={() => {}} onRegenerate={() => {}} onRegenerateWithEdits={() => {}} />);
