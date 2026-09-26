/**
 * UploadPanel コンポーネントのユニットテスト
 * タスク 14.3: 各表示状態の検証（Requirements 5.3, 5.4, 5.7, 5.8）
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { UploadResult } from "../types/index";
import UploadPanel, {
  type UploadProgress,
} from "../components/UploadPanel";

// ---------------------------------------------------------------------------
// テストヘルパー
// ---------------------------------------------------------------------------

/** 成功時の UploadResult を生成する。 */
function successResult(overrides: Partial<UploadResult> = {}): UploadResult {
  return {
    success: true,
    applicationId: "APP-12345",
    status: "審査中",
    retryCount: 0,
    ...overrides,
  };
}

/** 失敗時の UploadResult を生成する。 */
function errorResult(
  errorType: NonNullable<UploadResult["errorType"]>,
  overrides: Partial<UploadResult> = {}
): UploadResult {
  return {
    success: false,
    errorType,
    retryCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// エラー結果の表示（Requirement 5.3, 5.4, 5.7）
// ---------------------------------------------------------------------------

describe("UploadPanel - エラー結果の表示", () => {
  it("認証エラー（auth）時に日本語の認証エラーメッセージを alert として表示する", () => {
    render(
      <UploadPanel
        isValidForUpload={true}
        credentialsConfigured={true}
        result={errorResult("auth")}
        onUpload={vi.fn()}
      />
    );

    // 結果は role="alert" 内に表示される
    const alert = screen.getByText(/認証エラーが発生しました/);
    expect(alert).toBeInTheDocument();
    expect(screen.getByText("アップロードに失敗しました。")).toBeInTheDocument();
  });

  it("ネットワークエラー（network）時に日本語メッセージとリトライ回数を表示する", () => {
    render(
      <UploadPanel
        isValidForUpload={true}
        credentialsConfigured={true}
        result={errorResult("network", { retryCount: 3 })}
        onUpload={vi.fn()}
      />
    );

    expect(
      screen.getByText(/ネットワークエラーが発生しました/)
    ).toBeInTheDocument();
    // リトライ回数の表示（Requirement 5.4）
    expect(screen.getByText(/自動リトライ回数: 3 回/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 成功結果の表示（Requirement 5.3）
// ---------------------------------------------------------------------------

describe("UploadPanel - 成功結果の表示", () => {
  it("成功時に申請IDとステータスを status として表示する", () => {
    render(
      <UploadPanel
        isValidForUpload={true}
        credentialsConfigured={true}
        result={successResult({ applicationId: "APP-99999", status: "受付完了" })}
        onUpload={vi.fn()}
      />
    );

    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(screen.getByText("APP-99999")).toBeInTheDocument();
    expect(screen.getByText("受付完了")).toBeInTheDocument();
    expect(
      screen.getByText("アップロードが完了しました。")
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 認証情報未設定（Requirement 5.8）
// ---------------------------------------------------------------------------

describe("UploadPanel - 認証情報未設定", () => {
  it("credentialsConfigured=false のとき未設定メッセージを表示しボタンを無効化する", () => {
    render(
      <UploadPanel
        isValidForUpload={true}
        credentialsConfigured={false}
        onUpload={vi.fn()}
      />
    );

    // 認証情報未設定メッセージ（role=alert）
    expect(
      screen.getByText(/認証情報が設定されていません/)
    ).toBeInTheDocument();

    // アップロードボタンは無効
    const button = screen.getByRole("button", { name: "アップロードする" });
    expect(button).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// アップロードボタンの活性制御とハンドラ発火
// ---------------------------------------------------------------------------

describe("UploadPanel - アップロードボタンの制御", () => {
  it("isValidForUpload=false のときボタンを無効化する", () => {
    render(
      <UploadPanel
        isValidForUpload={false}
        credentialsConfigured={true}
        onUpload={vi.fn()}
      />
    );

    const button = screen.getByRole("button", { name: "アップロードする" });
    expect(button).toBeDisabled();
  });

  it("バリデーション通過かつ認証情報設定済みのときボタンが有効で onUpload を発火する", () => {
    const onUpload = vi.fn();
    render(
      <UploadPanel
        isValidForUpload={true}
        credentialsConfigured={true}
        onUpload={onUpload}
      />
    );

    const button = screen.getByRole("button", { name: "アップロードする" });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    expect(onUpload).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 進捗バーの表示
// ---------------------------------------------------------------------------

describe("UploadPanel - 進捗バーの表示", () => {
  it("progress が渡されたとき progressbar とメッセージをレンダリングする", () => {
    const progress: UploadProgress = {
      phase: "uploading",
      completed: 2,
      total: 4,
      message: "画像をアップロード中...",
    };
    render(
      <UploadPanel
        isValidForUpload={true}
        credentialsConfigured={true}
        progress={progress}
        onUpload={vi.fn()}
      />
    );

    const bar = screen.getByRole("progressbar", { name: "アップロード進捗" });
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("画像をアップロード中...")).toBeInTheDocument();

    // アップロード中はボタンラベルが切り替わり無効化される
    const button = screen.getByRole("button", { name: "アップロード中..." });
    expect(button).toBeDisabled();
  });
});
