import { describe, expect, it, vi } from "vitest";

import type {
  GeneratedImage,
  ProcessedImageSet,
  StampImage,
  StampSet,
} from "../types/index";
import { appReducer, initialAppState } from "../stores/appStore";
import {
  buildStampSetFromGeneratedImages,
  recalculateStampSet,
  validateStampSet,
} from "../utils/stampSet";

function processed(index: number): ProcessedImageSet {
  return {
    stampPath: `C:/tmp/${index}_stamp.png`,
    mainImagePath: `C:/tmp/${index}_main.png`,
    thumbnailPath: `C:/tmp/${index}_thumb.png`,
    stampDataUrl: `data:image/png;base64,stamp${index}`,
    mainImageDataUrl: `data:image/png;base64,main${index}`,
    thumbnailDataUrl: `data:image/png;base64,thumb${index}`,
    validation: {
      passed: true,
      sizeOk: true,
      formatOk: true,
      fileSizeOk: true,
      fileSizeExceeded: false,
      details: "適合",
    },
  };
}

function stampImage(index: number): StampImage {
  const result = processed(index);
  return {
    sourcePath: `C:/tmp/${index}.png`,
    stampPath: result.stampPath,
    mainImagePath: result.mainImagePath,
    thumbnailPath: result.thumbnailPath,
    stampPreviewUrl: result.stampDataUrl,
    mainImagePreviewUrl: result.mainImageDataUrl,
    thumbnailPreviewUrl: result.thumbnailDataUrl,
    processingStatus: "done",
    validationResult: result.validation,
  };
}

function stampSet(count = 8): StampSet {
  return recalculateStampSet({
    title: "有効なタイトル",
    description: "説明",
    images: Array.from({ length: count }, (_, index) => stampImage(index)),
    isValidForUpload: false,
  });
}

describe("生成画像からStampSetへの変換", () => {
  it("一部の変換が失敗しても後続を処理し、失敗位置を保持する", async () => {
    const generated: GeneratedImage[] = [
      { index: 0, dataUrl: "preview0", tempFilePath: "0.png", status: "done" },
      { index: 1, dataUrl: "preview1", tempFilePath: "1.png", status: "done" },
      { index: 2, dataUrl: "preview2", tempFilePath: "2.png", status: "done" },
    ];
    const processImage = vi.fn(async (path: string) => {
      if (path === "1.png") throw new Error("変換エラー");
      return processed(Number(path[0]));
    });

    const result = await buildStampSetFromGeneratedImages(generated, processImage);

    expect(processImage).toHaveBeenCalledTimes(3);
    expect(result.failedCount).toBe(1);
    expect(result.stampSet.images).toHaveLength(3);
    expect(result.stampSet.images[0].processingStatus).toBe("done");
    expect(result.stampSet.images[1].processingStatus).toBe("error");
    expect(result.stampSet.images[1].sourcePath).toBe("1.png");
    expect(result.stampSet.images[2].processingStatus).toBe("done");
  });
});

describe("StampSet全体バリデーション", () => {
  it("メタデータ・枚数・全画像が適合するとアップロード可能", () => {
    const result = validateStampSet(stampSet(8));
    expect(result.canExport).toBe(true);
    expect(result.isValidForUpload).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("枚数不足ではアップロード不可だが、完成画像はエクスポート可能", () => {
    const result = validateStampSet(stampSet(7));
    expect(result.canExport).toBe(true);
    expect(result.isValidForUpload).toBe(false);
    expect(result.issues.some((issue) => issue.includes("枚数"))).toBe(true);
  });

  it("画像処理中はreducerがアップロード可否を再計算する", () => {
    const current = { ...initialAppState, stampSet: stampSet(8), step: "edit" as const };
    const next = appReducer(current, {
      type: "START_STAMP_IMAGE_PROCESSING",
      index: 0,
      sourcePath: "replacement.png",
    });

    expect(next.stampSet?.images[0].processingStatus).toBe("processing");
    expect(next.stampSet?.isValidForUpload).toBe(false);
  });
});
