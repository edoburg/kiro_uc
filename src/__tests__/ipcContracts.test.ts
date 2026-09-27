import { describe, expect, it } from "vitest";

import type { StampSet } from "../types/index";
import {
  toExportCreateRequest,
  toUploadErrorResult,
  toUploadResult,
  toUploadStartRequest,
} from "../utils/ipcMappers";

function makeStampSet(): StampSet {
  return {
    title: "テストセット",
    description: "説明",
    creatorName: "テスト作者",
    copyright: "© Test Creator",
    images: [
      {
        sourcePath: "C:/tmp/source.png",
        stampPath: "C:/tmp/stamp.png",
        mainImagePath: "C:/tmp/main.png",
        thumbnailPath: "C:/tmp/thumb.png",
        stampPreviewUrl: "data:image/png;base64,c3RhbXA=",
        mainImagePreviewUrl: "data:image/png;base64,bWFpbg==",
        thumbnailPreviewUrl: "data:image/png;base64,dGh1bWI=",
        processingStatus: "done",
        validationResult: {
          passed: true,
          sizeOk: true,
          formatOk: true,
          fileSizeOk: true,
          fileSizeExceeded: false,
          details: "適合",
        },
      },
    ],
    isValidForUpload: true,
  };
}

describe("IPC契約mapper", () => {
  it("StampSetをプレビュー情報を含まないZIPエクスポート要求へ変換する", () => {
    const request = toExportCreateRequest(makeStampSet(), "C:/exports");

    expect(request).toEqual({
      stampSet: {
        title: "テストセット",
        description: "説明",
        images: [
          {
            stampPath: "C:/tmp/stamp.png",
            mainImagePath: "C:/tmp/main.png",
            thumbnailPath: "C:/tmp/thumb.png",
          },
        ],
      },
      defaultDirectory: "C:/exports",
    });
    expect(JSON.stringify(request)).not.toContain("PreviewUrl");
    expect(JSON.stringify(request)).not.toContain("validationResult");
  });

  it("StampSetを余分なフィールドのないcamelCaseアップロード要求へ変換する", () => {
    const request = toUploadStartRequest(makeStampSet());

    expect(request).toEqual({
      stampSet: {
        title: "テストセット",
        description: "説明",
        creatorName: "テスト作者",
        copyright: "© Test Creator",
        images: [
          {
            stampPath: "C:/tmp/stamp.png",
            mainImagePath: "C:/tmp/main.png",
            thumbnailPath: "C:/tmp/thumb.png",
          },
        ],
        mainImagePath: "C:/tmp/main.png",
        thumbnailPath: "C:/tmp/thumb.png",
      },
      emailCredentialKey: "line_email",
      passwordCredentialKey: "line_password",
    });
    expect(JSON.stringify(request)).not.toContain("validationResult");
    expect(JSON.stringify(request)).not.toContain("isValidForUpload");
  });

  it("画像がない場合は代表画像パスをnullにする", () => {
    const stampSet = makeStampSet();
    stampSet.images = [];

    const request = toUploadStartRequest(stampSet);

    expect(request.stampSet.mainImagePath).toBeNull();
    expect(request.stampSet.thumbnailPath).toBeNull();
  });

  it("アップロード完了ペイロードをUI型へ変換する", () => {
    expect(
      toUploadResult({
        success: true,
        applicationId: "12345",
        status: "draft",
        errorType: null,
        retryCount: 0,
        errorMessage: null,
      }),
    ).toEqual({
      success: true,
      applicationId: "12345",
      status: "draft",
      retryCount: 0,
    });
  });

  it("SSEエラーを未知の値で補完してUI型へ変換する", () => {
    expect(toUploadErrorResult({ message: "接続が切断されました。" })).toEqual({
      success: false,
      errorType: "unknown",
      retryCount: 0,
      errorMessage: "接続が切断されました。",
    });
  });
});
