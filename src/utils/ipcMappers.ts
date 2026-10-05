import type { StampImage, StampSet, UploadResult } from "../types/index";
import type {
  ExportCreateRequest,
  ExportImageRequest,
  StreamErrorPayload,
  UploadResultPayload,
  UploadStartRequest,
} from "../types/ipc";
import { isExportableImage, requireRepresentativeImages } from "./stampSet";

function toImageRequest(image: StampImage): ExportImageRequest {
  return {
    id: image.id,
    stampPath: image.stampPath,
    mainImagePath: image.mainImagePath,
    thumbnailPath: image.thumbnailPath,
  };
}

/**
 * UIドメインのStampSetからZIPエクスポート要求を生成する。
 * 変換済み画像だけを元の順序で送り、メイン／タブ画像は配列位置ではなく画像IDで指定する。
 * 選択を解決できない場合は日本語の Error を投げる（先頭画像へ切り替えない）。
 */
export function toExportCreateRequest(
  stampSet: StampSet,
  defaultDirectory: string,
): ExportCreateRequest {
  const representatives = requireRepresentativeImages(stampSet);
  return {
    stampSet: {
      title: stampSet.title,
      description: stampSet.description,
      images: stampSet.images.filter(isExportableImage).map(toImageRequest),
      mainImageId: representatives.main.imageId,
      tabImageId: representatives.tab.imageId,
    },
    defaultDirectory,
  };
}

/**
 * UIドメインのStampSetから、FastAPIへ送るアップロード要求を生成する。
 * validationResultなどAPIが受け付けないフィールドは境界で除外する。
 * ZIPと同じ選択解決処理を使い、選択画像の派生パスを mainImagePath／thumbnailPath に設定する。
 */
export function toUploadStartRequest(stampSet: StampSet): UploadStartRequest {
  const representatives = requireRepresentativeImages(stampSet);
  return {
    stampSet: {
      title: stampSet.title,
      description: stampSet.description,
      creatorName: stampSet.creatorName,
      copyright: stampSet.copyright,
      images: stampSet.images.map(toImageRequest),
      mainImageId: representatives.main.imageId,
      tabImageId: representatives.tab.imageId,
      mainImagePath: representatives.main.path,
      thumbnailPath: representatives.tab.path,
    },
    emailCredentialKey: "line_email",
    passwordCredentialKey: "line_password",
  };
}

/** SSEの完了ペイロードをUIドメインのUploadResultへ変換する。 */
export function toUploadResult(payload: UploadResultPayload): UploadResult {
  return {
    success: payload.success,
    retryCount: payload.retryCount,
    ...(payload.applicationId ? { applicationId: payload.applicationId } : {}),
    ...(payload.status ? { status: payload.status } : {}),
    ...(payload.errorType ? { errorType: payload.errorType } : {}),
    ...(payload.errorMessage ? { errorMessage: payload.errorMessage } : {}),
  };
}

/** SSEの通信・認証エラーをUIドメインのUploadResultへ変換する。 */
export function toUploadErrorResult(
  payload: UploadResultPayload | StreamErrorPayload,
): UploadResult {
  if ("success" in payload) {
    return toUploadResult(payload);
  }
  return {
    success: false,
    errorType: payload.errorType ?? "unknown",
    retryCount: 0,
    errorMessage: payload.message || "アップロードに失敗しました。",
  };
}
