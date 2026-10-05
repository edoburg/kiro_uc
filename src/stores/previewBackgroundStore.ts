import { create } from "zustand";
import type { PreviewBackground } from "../types";

/** 表示専用。生成要求・保存画像とは独立し、起動中だけ共有する。 */
export const usePreviewBackground = create<{
  background: PreviewBackground;
  customColor: string;
  setBackground: (background: PreviewBackground) => void;
  setCustomColor: (customColor: string) => void;
}>((set) => ({
  background: "checker", customColor: "#80c0ff",
  setBackground: (background) => set({ background }),
  setCustomColor: (customColor) => set({ customColor, background: "custom" }),
}));
