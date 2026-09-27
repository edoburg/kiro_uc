import type {
  GeneratedImage,
  ProcessedImageSet,
  StampImage,
  StampSet,
} from "../types/index";
import { validateDescription, validateTitle } from "./validation";

const VALID_STAMP_COUNTS = new Set([8, 16, 24, 32, 40]);

export interface StampSetValidation {
  canExport: boolean;
  isValidForUpload: boolean;
  issues: string[];
}

export interface StampSetBuildResult {
  stampSet: StampSet;
  failedCount: number;
}

/** 編集中のセットを、ZIP出力条件とLINEアップロード条件に分けて検証する。 */
export function validateStampSet(stampSet: StampSet): StampSetValidation {
  const titleError = validateTitle(stampSet.title);
  const descriptionError = validateDescription(stampSet.description);
  const completedImages = stampSet.images.filter(
    (image) => image.processingStatus === "done",
  );
  const failedImages = stampSet.images.filter(
    (image) => image.processingStatus !== "done",
  );
  const invalidImages = stampSet.images.filter(
    (image) =>
      image.processingStatus === "done" && !image.validationResult.passed,
  );

  const issues: string[] = [];
  if (titleError) issues.push(titleError.message);
  if (descriptionError) issues.push(descriptionError.message);
  if (!VALID_STAMP_COUNTS.has(stampSet.images.length)) {
    issues.push("スタンプ画像の枚数は8・16・24・32・40枚のいずれかにしてください。");
  }
  if (failedImages.length > 0) {
    issues.push(`変換が完了していない画像が${failedImages.length}枚あります。`);
  }
  if (invalidImages.length > 0) {
    issues.push(`LINE規格に適合していない画像が${invalidImages.length}枚あります。`);
  }

  const metadataValid = titleError === null && descriptionError === null;
  const canExport = metadataValid && completedImages.length > 0;
  const isValidForUpload =
    metadataValid &&
    VALID_STAMP_COUNTS.has(stampSet.images.length) &&
    failedImages.length === 0 &&
    invalidImages.length === 0;

  return { canExport, isValidForUpload, issues };
}

/** isValidForUploadを現在の内容から再計算した新しいStampSetを返す。 */
export function recalculateStampSet(stampSet: StampSet): StampSet {
  const validation = validateStampSet(stampSet);
  return { ...stampSet, isValidForUpload: validation.isValidForUpload };
}

/** 画像処理APIの結果を編集・アップロード用のStampImageへ変換する。 */
export function toStampImage(
  sourcePath: string,
  processed: ProcessedImageSet,
  fallbackPreviewUrl = "",
): StampImage {
  return {
    sourcePath,
    stampPath: processed.stampPath,
    mainImagePath: processed.mainImagePath,
    thumbnailPath: processed.thumbnailPath,
    stampPreviewUrl: processed.stampDataUrl || fallbackPreviewUrl,
    mainImagePreviewUrl: processed.mainImageDataUrl || fallbackPreviewUrl,
    thumbnailPreviewUrl: processed.thumbnailDataUrl || fallbackPreviewUrl,
    processingStatus: "done",
    validationResult: processed.validation,
  };
}

/** 変換失敗画像を位置を保ったまま編集画面へ残す。 */
export function toFailedStampImage(
  generated: GeneratedImage,
  message: string,
): StampImage {
  return {
    sourcePath: generated.tempFilePath,
    stampPath: "",
    mainImagePath: "",
    thumbnailPath: "",
    stampPreviewUrl: generated.dataUrl,
    mainImagePreviewUrl: generated.dataUrl,
    thumbnailPreviewUrl: generated.dataUrl,
    processingStatus: "error",
    processingError: message,
    validationResult: {
      passed: false,
      sizeOk: false,
      formatOk: false,
      fileSizeOk: false,
      fileSizeExceeded: false,
      details: message,
    },
  };
}

/**
 * 生成済み画像を順番にLINE規格へ変換する。一部が失敗しても残りを継続し、
 * 失敗画像は再試行可能な状態でセット内へ残す。
 */
export async function buildStampSetFromGeneratedImages(
  generatedImages: GeneratedImage[],
  processImage: (sourcePath: string) => Promise<ProcessedImageSet>,
): Promise<StampSetBuildResult> {
  const images: StampImage[] = [];
  let failedCount = 0;

  for (const generated of [...generatedImages].sort((a, b) => a.index - b.index)) {
    if (generated.status !== "done" || !generated.tempFilePath) {
      failedCount += 1;
      images.push(
        toFailedStampImage(
          generated,
          generated.errorMessage ?? "生成画像が完成していないため変換できませんでした。",
        ),
      );
      continue;
    }

    try {
      const processed = await processImage(generated.tempFilePath);
      images.push(toStampImage(generated.tempFilePath, processed, generated.dataUrl));
    } catch (error) {
      failedCount += 1;
      const message =
        error instanceof Error && error.message
          ? error.message
          : "LINE規格への画像変換に失敗しました。";
      images.push(toFailedStampImage(generated, message));
    }
  }

  const stampSet = recalculateStampSet({
    title: "",
    description: "",
    images,
    isValidForUpload: false,
  });
  return { stampSet, failedCount };
}
