/** preload.ts が公開する window.api のアンビエント型宣言。 */

import type { RendererApi } from "./ipc";
export type {
  GenerationStreamPayload,
  StreamErrorPayload,
  UploadStreamPayload,
} from "./ipc";

declare global {
  interface Window {
    /** Electron外のテスト・ブラウザ環境では存在しない。 */
    api?: RendererApi;
  }
}

export {};
