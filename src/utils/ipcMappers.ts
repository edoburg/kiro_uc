import type { StampSet } from "../types/index";
import type { ExportCreateRequest, UploadStartRequest } from "../types/ipc";

/** UIドメインのStampSetからZIPエクスポート要求を生成する。 */
export function toExportCreateRequest(
  stampSet: StampSet,
  defaultDirectory: string,
): ExportCreateRequest {
  return {
    stampSet: {
      title: stampSet.title,
      description: stampSet.description,
      images: stampSet.images
        .filter(
          (image) =>
            image.processingStatus === "done" &&
            image.stampPath.length > 0 &&
            image.mainImagePath.length > 0 &&
            image.thumbnailPath.length > 0,
        )
        .map((image) => ({
          stampPath: image.stampPath,
          mainImagePath: image.mainImagePath,
          thumbnailPath: image.thumbnailPath,
        })),
    },
    defaultDirectory,
  };
}

/**
 * UIドメインのStampSetから、FastAPIへ送るアップロード要求を生成する。
 * validationResultなどAPIが受け付けないフィールドは境界で除外する。
 */
export function toUploadStartRequest(stampSet: StampSet): UploadStartRequest {
  const representative = stampSet.images[0];
  return {
    stampSet: {
      title: stampSet.title,
      description: stampSet.description,
      images: stampSet.images.map((image) => ({
        stampPath: image.stampPath,
        mainImagePath: image.mainImagePath,
        thumbnailPath: image.thumbnailPath,
      })),
      mainImagePath: representative?.mainImagePath ?? null,
      thumbnailPath: representative?.thumbnailPath ?? null,
    },
    emailCredentialKey: "line_email",
    passwordCredentialKey: "line_password",
  };
}
