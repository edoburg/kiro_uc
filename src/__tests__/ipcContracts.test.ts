import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { StampImage, StampSet } from "../types/index";
import {
  toExportCreateRequest,
  toUploadErrorResult,
  toUploadResult,
  toUploadStartRequest,
} from "../utils/ipcMappers";

function makeImage(index: number, id = `item-${index}`): StampImage {
  return {
    id,
    sourcePath: `C:/tmp/source-${index}.png`,
    stampPath: `C:/tmp/stamp-${index}.png`,
    mainImagePath: `C:/tmp/main-${index}.png`,
    thumbnailPath: `C:/tmp/thumb-${index}.png`,
    stampPreviewUrl: `data:image/png;base64,stamp${index}`,
    mainImagePreviewUrl: `data:image/png;base64,main${index}`,
    thumbnailPreviewUrl: `data:image/png;base64,thumb${index}`,
    processingStatus: "done",
    validationResult: {
      passed: true,
      sizeOk: true,
      formatOk: true,
      fileSizeOk: true,
      fileSizeExceeded: false,
      details: "適合",
    },
  };
}

function makeStampSet(count = 1): StampSet {
  return {
    title: "テストセット",
    description: "説明",
    creatorName: "テスト作者",
    copyright: "© Test Creator",
    images: Array.from({ length: count }, (_, index) => makeImage(index)),
    mainImageId: "item-0",
    tabImageId: "item-0",
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
            id: "item-0",
            stampPath: "C:/tmp/stamp-0.png",
            mainImagePath: "C:/tmp/main-0.png",
            thumbnailPath: "C:/tmp/thumb-0.png",
          },
        ],
        mainImageId: "item-0",
        tabImageId: "item-0",
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
            id: "item-0",
            stampPath: "C:/tmp/stamp-0.png",
            mainImagePath: "C:/tmp/main-0.png",
            thumbnailPath: "C:/tmp/thumb-0.png",
          },
        ],
        mainImageId: "item-0",
        tabImageId: "item-0",
        mainImagePath: "C:/tmp/main-0.png",
        thumbnailPath: "C:/tmp/thumb-0.png",
      },
      emailCredentialKey: "line_email",
      passwordCredentialKey: "line_password",
    });
    expect(JSON.stringify(request)).not.toContain("validationResult");
    expect(JSON.stringify(request)).not.toContain("isValidForUpload");
  });

  it("メインに3枚目・タブに5枚目を選ぶとZIPとアップロード要求が同じ派生画像を指す", () => {
    const stampSet = { ...makeStampSet(8), mainImageId: "item-2", tabImageId: "item-4" };

    const exportRequest = toExportCreateRequest(stampSet, "");
    const uploadRequest = toUploadStartRequest(stampSet);

    expect(exportRequest.stampSet.mainImageId).toBe("item-2");
    expect(exportRequest.stampSet.tabImageId).toBe("item-4");
    expect(exportRequest.stampSet.images.map((image) => image.id)).toEqual(
      stampSet.images.map((image) => image.id),
    );
    expect(uploadRequest.stampSet.mainImageId).toBe("item-2");
    expect(uploadRequest.stampSet.tabImageId).toBe("item-4");
    expect(uploadRequest.stampSet.mainImagePath).toBe("C:/tmp/main-2.png");
    expect(uploadRequest.stampSet.thumbnailPath).toBe("C:/tmp/thumb-4.png");
  });

  it("出力対象の絞り込み後も位置ではなくIDで選択画像を参照する", () => {
    const stampSet = { ...makeStampSet(5), mainImageId: "item-3", tabImageId: "item-4" };
    stampSet.images[0] = {
      ...stampSet.images[0],
      processingStatus: "error",
      stampPath: "",
      mainImagePath: "",
      thumbnailPath: "",
    };

    const request = toExportCreateRequest(stampSet, "");

    expect(request.stampSet.images.map((image) => image.id)).toEqual([
      "item-1",
      "item-2",
      "item-3",
      "item-4",
    ]);
    const main = request.stampSet.images.find((image) => image.id === request.stampSet.mainImageId);
    expect(main?.mainImagePath).toBe("C:/tmp/main-3.png");
  });

  it("未選択・セット外・変換失敗の選択は先頭へ補正せずエラーにする", () => {
    const unselected = { ...makeStampSet(3), mainImageId: null };
    const unknown = { ...makeStampSet(3), tabImageId: "missing" };
    const failed = { ...makeStampSet(3), mainImageId: "item-1" };
    failed.images[1] = { ...failed.images[1], processingStatus: "error" };

    expect(() => toExportCreateRequest(unselected, "")).toThrow("メイン画像が選択されていません");
    expect(() => toUploadStartRequest(unselected)).toThrow("メイン画像が選択されていません");
    expect(() => toExportCreateRequest(unknown, "")).toThrow("見つかりません");
    expect(() => toUploadStartRequest(failed)).toThrow("変換に失敗しています");
  });

  // Feature: line-stamp-generator, Property 20: ZIPとアップロード要求は同じ選択画像を参照する
  it("任意の選択位置でZIPとアップロード要求の選択IDと派生パスが一致する", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }).chain((count) =>
          fc.tuple(
            fc.constant(count),
            fc.integer({ min: 0, max: count - 1 }),
            fc.integer({ min: 0, max: count - 1 }),
          ),
        ),
        ([count, mainIndex, tabIndex]) => {
          const stampSet = {
            ...makeStampSet(count),
            mainImageId: `item-${mainIndex}`,
            tabImageId: `item-${tabIndex}`,
          };
          const exportRequest = toExportCreateRequest(stampSet, "");
          const uploadRequest = toUploadStartRequest(stampSet);
          const exportMain = exportRequest.stampSet.images.find(
            (image) => image.id === exportRequest.stampSet.mainImageId,
          );
          const exportTab = exportRequest.stampSet.images.find(
            (image) => image.id === exportRequest.stampSet.tabImageId,
          );
          expect(exportMain?.mainImagePath).toBe(uploadRequest.stampSet.mainImagePath);
          expect(exportTab?.thumbnailPath).toBe(uploadRequest.stampSet.thumbnailPath);
          expect(uploadRequest.stampSet.mainImagePath).toBe(`C:/tmp/main-${mainIndex}.png`);
          expect(uploadRequest.stampSet.thumbnailPath).toBe(`C:/tmp/thumb-${tabIndex}.png`);
          expect(exportRequest.stampSet.images.map((image) => image.stampPath)).toEqual(
            stampSet.images.map((image) => image.stampPath),
          );
        },
      ),
      { numRuns: 100 },
    );
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
