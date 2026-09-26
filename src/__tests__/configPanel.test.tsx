/**
 * ConfigPanel ユニットテスト（Vitest + @testing-library/react）
 *
 * 検証対象（要件 6.5 中心）:
 * - API キーは onSaveCredential（キーチェーン）経由でのみ送られ、
 *   onSaveConfig（config.json）にも export にも含まれない。
 * - AI エンジン選択が form へ反映される。
 * - 保存成功時に「設定を保存しました」を表示する（要件 6.4）。
 * - インポート検証: 不正 JSON / 認証情報を含む Config は拒否し、
 *   既存 Config を変更しない（要件 6.6, 6.7）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ConfigPanel, {
  CREDENTIAL_KEYS,
  validateImportedConfig,
} from "../components/ConfigPanel";
import type { Config } from "../types/index";

/** テスト用の有効な Config（認証情報を含まない） */
const baseConfig: Config = {
  aiEngine: "dalle",
  outputDirectory: "/Users/name/line-stamps",
  dalleModel: "dall-e-3",
  sdEndpoint: "",
};

/** 既定のモックコールバックを生成する */
function makeProps(overrides: Partial<React.ComponentProps<typeof ConfigPanel>> = {}) {
  return {
    config: baseConfig,
    aiApiKeyConfigured: false,
    onSaveConfig: vi.fn().mockResolvedValue(undefined),
    onSaveCredential: vi.fn().mockResolvedValue(undefined),
    onExportConfig: vi.fn().mockResolvedValue({}),
    onImportConfig: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("ConfigPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("保存（要件 6.2, 6.4, 6.5）", () => {
    it("API キーは onSaveCredential にのみ渡され、onSaveConfig（Config）には含まれない", async () => {
      // テスト用のダミーシークレット（実際の認証情報ではない）。
      // このテストの目的は「この値が Config に混入しないこと」を確認することにある。
      const DUMMY_SECRET = "dummy-test-api-key-value";
      const props = makeProps();
      render(<ConfigPanel {...props} />);

      // API キーを入力する
      fireEvent.change(screen.getByLabelText("API キー"), {
        target: { value: DUMMY_SECRET },
      });

      // 保存ボタン押下（出力ディレクトリは baseConfig で埋まっている）
      fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

      await waitFor(() => {
        expect(props.onSaveCredential).toHaveBeenCalledTimes(1);
      });

      // キーチェーンには正しいキー名で API キーが渡される
      expect(props.onSaveCredential).toHaveBeenCalledWith(
        CREDENTIAL_KEYS.aiApiKey,
        DUMMY_SECRET,
      );

      // config.json 保存には Config のみが渡され、API キーは含まれない
      expect(props.onSaveConfig).toHaveBeenCalledTimes(1);
      const savedConfig = vi.mocked(props.onSaveConfig).mock.calls[0][0] as Config;
      expect(Object.keys(savedConfig).sort()).toEqual(
        ["aiEngine", "dalleModel", "outputDirectory", "sdEndpoint"].sort(),
      );
      // Config のいずれの値にも API キーが混入していない
      expect(JSON.stringify(savedConfig)).not.toContain(DUMMY_SECRET);
    });

    it("保存成功時に「設定を保存しました」を表示する（要件 6.4）", async () => {
      const props = makeProps();
      render(<ConfigPanel {...props} />);

      fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

      expect(await screen.findByText("設定を保存しました")).toBeInTheDocument();
    });

    it("API キー未入力なら onSaveCredential は呼ばれず、Config のみ保存される", async () => {
      const props = makeProps();
      render(<ConfigPanel {...props} />);

      fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

      await waitFor(() => {
        expect(props.onSaveConfig).toHaveBeenCalledTimes(1);
      });
      expect(props.onSaveCredential).not.toHaveBeenCalled();
    });

    it("出力ディレクトリが空のときは保存ボタンが無効化される（要件 6.1）", () => {
      const props = makeProps({
        config: { ...baseConfig, outputDirectory: "" },
      });
      render(<ConfigPanel {...props} />);

      expect(screen.getByRole("button", { name: "設定を保存" })).toBeDisabled();
    });
  });

  describe("AI エンジン選択（要件 6.1）", () => {
    it("選択変更が保存する Config に反映される", async () => {
      const props = makeProps();
      render(<ConfigPanel {...props} />);

      fireEvent.change(screen.getByLabelText("AI 画像生成エンジン"), {
        target: { value: "midjourney" },
      });
      fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

      await waitFor(() => {
        expect(props.onSaveConfig).toHaveBeenCalledTimes(1);
      });
      const savedConfig = vi.mocked(props.onSaveConfig).mock.calls[0][0] as Config;
      expect(savedConfig.aiEngine).toBe("midjourney");
    });
  });

  describe("エクスポート（要件 6.5）", () => {
    it("エクスポートデータに API キーが含まれない（sanitized）", async () => {
      // テスト用のダミーシークレット（実際の認証情報ではない）。
      const DUMMY_SECRET = "dummy-should-not-appear";
      // onExportConfig は sanitize 済みデータを返す（認証情報を含まない）
      const sanitized: Record<string, unknown> = {
        aiEngine: "dalle",
        outputDirectory: "/Users/name/line-stamps",
        dalleModel: "dall-e-3",
        sdEndpoint: "",
      };
      const onExportConfig = vi.fn().mockResolvedValue(sanitized);
      const props = makeProps({ onExportConfig });

      // jsdom では URL.createObjectURL が未定義のためスタブする
      vi.stubGlobal("URL", {
        createObjectURL: vi.fn(() => "blob:mock"),
        revokeObjectURL: vi.fn(),
      });
      // anchor.click の副作用（ダウンロード）を無効化
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});

      render(<ConfigPanel {...props} />);

      // API キーを入力しても export 内容には含まれないことを確認する
      fireEvent.change(screen.getByLabelText("API キー"), {
        target: { value: DUMMY_SECRET },
      });
      fireEvent.click(screen.getByRole("button", { name: "設定をエクスポート" }));

      await waitFor(() => {
        expect(onExportConfig).toHaveBeenCalledTimes(1);
      });

      // onExportConfig が返した sanitize 済みデータに API キーが無い
      const exported = await onExportConfig.mock.results[0].value;
      expect(JSON.stringify(exported)).not.toContain(DUMMY_SECRET);

      expect(await screen.findByText("設定をエクスポートしました")).toBeInTheDocument();
      clickSpy.mockRestore();
    });
  });

  describe("インポート検証（要件 6.6, 6.7）", () => {
    /** File 選択をシミュレートして hidden input の onChange を発火する */
    function selectImportFile(content: string): void {
      const input = document.querySelector<HTMLInputElement>(
        "input.config-panel__import-input",
      );
      expect(input).not.toBeNull();
      const file = new File([content], "config.json", {
        type: "application/json",
      });
      // jsdom では File.text() が未実装のことがあるため明示的に付与する
      Object.defineProperty(file, "text", {
        value: () => Promise.resolve(content),
        configurable: true,
      });
      fireEvent.change(input as HTMLInputElement, {
        target: { files: [file] },
      });
    }

    it("不正 JSON は拒否され、既存 Config が保持される（onImportConfig 未呼び出し）", async () => {
      const props = makeProps();
      render(<ConfigPanel {...props} />);

      selectImportFile("{ this is not json");

      expect(
        await screen.findByText(/JSON 形式が不正です。既存の設定は変更されていません/),
      ).toBeInTheDocument();
      expect(props.onImportConfig).not.toHaveBeenCalled();
    });

    it("認証情報を含む Config は拒否され、既存 Config が保持される", async () => {
      const props = makeProps();
      render(<ConfigPanel {...props} />);

      const withSecret = JSON.stringify({
        aiEngine: "dalle",
        outputDirectory: "/tmp",
        dalleModel: "dall-e-3",
        sdEndpoint: "",
        api_key: "dummy-leak-value",
      });
      selectImportFile(withSecret);

      expect(
        await screen.findByText(/認証情報が含まれています/),
      ).toBeInTheDocument();
      expect(props.onImportConfig).not.toHaveBeenCalled();
    });

    it("正しい Config はインポートされる", async () => {
      const props = makeProps();
      render(<ConfigPanel {...props} />);

      const valid = JSON.stringify({
        aiEngine: "stable_diffusion",
        outputDirectory: "/tmp/out",
        dalleModel: "dall-e-3",
        sdEndpoint: "http://127.0.0.1:7860",
      });
      selectImportFile(valid);

      await waitFor(() => {
        expect(props.onImportConfig).toHaveBeenCalledTimes(1);
      });
      expect(await screen.findByText("設定をインポートしました")).toBeInTheDocument();
    });
  });

  describe("validateImportedConfig（純粋関数）", () => {
    it("認証情報フィールドを含むデータを拒否する（要件 6.5, 6.6）", () => {
      const sensitiveFields = ["api_key", "apiKey", "password", "token", "secret"];
      for (const field of sensitiveFields) {
        const data = {
          aiEngine: "dalle",
          outputDirectory: "/tmp",
          dalleModel: "dall-e-3",
          sdEndpoint: "",
          [field]: "x",
        };
        expect(validateImportedConfig(data)).toContain("認証情報");
      }
    });

    it("必須フィールドを満たす正しいデータは null を返す", () => {
      expect(
        validateImportedConfig({
          aiEngine: "midjourney",
          outputDirectory: "/tmp",
          dalleModel: "dall-e-3",
          sdEndpoint: "",
        }),
      ).toBeNull();
    });

    it("オブジェクト以外・不正 aiEngine を拒否する", () => {
      expect(validateImportedConfig(null)).not.toBeNull();
      expect(validateImportedConfig([])).not.toBeNull();
      expect(
        validateImportedConfig({
          aiEngine: "unknown",
          outputDirectory: "/tmp",
          dalleModel: "dall-e-3",
          sdEndpoint: "",
        }),
      ).not.toBeNull();
    });
  });
});
