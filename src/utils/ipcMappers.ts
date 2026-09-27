import type { StampSet } from "../types/index";
import type { UploadStartRequest } from "../types/ipc";

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
