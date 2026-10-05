import type {
  GeneratedImage,
  ProcessedImageSet,
  RepresentativeRole,
  StampImage,
  StampSet,
  StampSetInput,
} from "../types/index";
import {
  validateCopyright,
  validateCreatorName,
  validateDescription,
  validateTitle,
} from "./validation";

const VALID_STAMP_COUNTS = new Set([8, 16, 24, 32, 40]);

/** 役割ごとのユーザー向け名称。 */
export const REPRESENTATIVE_ROLE_LABELS: Record<RepresentativeRole, string> = {
  main: "メイン画像",
  tab: "タブ画像",
};

export interface StampSetValidation {
  canExport: boolean;
  isValidForUpload: boolean;
  issues: string[];
}

export interface StampSetBuildResult {
  stampSet: StampSet;
  failedCount: number;
}

/** 選択済みで、派生画像を出力に使える状態。 */
export interface ResolvedRepresentative {
  status: "ok";
  imageId: string;
  /** 現在の一覧での位置（表示用。参照には使わない）。 */
  index: number;
  image: StampImage;
  /** 出力に使う派生画像パス（メインは mainImagePath、タブは thumbnailPath）。 */
  path: string;
  /** 派生画像そのもののプレビューURL。元画像へはフォールバックしない。 */
  previewUrl: string;
}

export type RepresentativeResolution =
  | ResolvedRepresentative
  | { status: "unselected" }
  | { status: "missing"; imageId: string }
  | {
      status: "unavailable";
      imageId: string;
      index: number;
      image: StampImage;
      reason: "processing" | "error" | "no_output";
    };

/** ZIP・アップロードの対象にできる変換済み画像か（3種類の出力がすべてある）。 */
export function isExportableImage(image: StampImage): boolean {
  return (
    image.processingStatus === "done" &&
    image.stampPath.length > 0 &&
    image.mainImagePath.length > 0 &&
    image.thumbnailPath.length > 0
  );
}

/** 役割に対応する派生画像のパス。 */
export function representativePath(
  image: StampImage,
  role: RepresentativeRole,
): string {
  return role === "main" ? image.mainImagePath : image.thumbnailPath;
}

/** 役割に対応する派生画像のプレビューURL。 */
export function representativePreviewUrl(
  image: StampImage,
  role: RepresentativeRole,
): string {
  return role === "main" ? image.mainImagePreviewUrl : image.thumbnailPreviewUrl;
}

/** メイン／タブ画像の元として選択できるか。未完了・失敗・出力なしは選択不可。 */
export function isSelectableRepresentative(
  image: StampImage,
  role: RepresentativeRole,
): boolean {
  return (
    isExportableImage(image) &&
    representativePath(image, role).toLowerCase().endsWith(".png")
  );
}

/** 選択IDをセット内の画像へ解決する。ZIP・アップロード・画面表示で共通に使う。 */
export function resolveRepresentativeImage(
  stampSet: StampSet,
  role: RepresentativeRole,
): RepresentativeResolution {
  const imageId = role === "main" ? stampSet.mainImageId : stampSet.tabImageId;
  if (imageId === null) {
    return { status: "unselected" };
  }
  const index = stampSet.images.findIndex((image) => image.id === imageId);
  if (index < 0) {
    return { status: "missing", imageId };
  }
  const image = stampSet.images[index];
  if (!isSelectableRepresentative(image, role)) {
    const reason =
      image.processingStatus === "processing"
        ? "processing"
        : image.processingStatus === "error"
          ? "error"
          : "no_output";
    return { status: "unavailable", imageId, index, image, reason };
  }
  return {
    status: "ok",
    imageId,
    index,
    image,
    path: representativePath(image, role),
    previewUrl: representativePreviewUrl(image, role),
  };
}

export function resolveRepresentativeImages(
  stampSet: StampSet,
): Record<RepresentativeRole, RepresentativeResolution> {
  return {
    main: resolveRepresentativeImage(stampSet, "main"),
    tab: resolveRepresentativeImage(stampSet, "tab"),
  };
}

/** 解決できない選択の理由を日本語で返す。問題がなければnull。 */
export function describeRepresentativeIssue(
  role: RepresentativeRole,
  resolution: RepresentativeResolution,
): string | null {
  const label = REPRESENTATIVE_ROLE_LABELS[role];
  switch (resolution.status) {
    case "ok":
      return null;
    case "unselected":
      return `${label}が選択されていません。一覧から「${label}に使う」を選んでください。`;
    case "missing":
      return `選択中の${label}がスタンプセット内に見つかりません。一覧から選び直してください。`;
    case "unavailable": {
      const position = `スタンプ ${resolution.index + 1}`;
      if (resolution.reason === "processing") {
        return `${label}に選択した${position} はLINE規格へ変換中です。完了までお待ちください。`;
      }
      if (resolution.reason === "error") {
        return `${label}に選択した${position} は変換に失敗しています。再試行するか別の画像を選んでください。`;
      }
      return `${label}に選択した${position} には有効な出力ファイルがありません。別の画像を選んでください。`;
    }
  }
}

/**
 * ZIP・アップロード要求用に両方の選択を解決する。解決できない場合は日本語の Error を投げ、
 * 先頭画像などへ黙って切り替えない。
 */
export function requireRepresentativeImages(
  stampSet: StampSet,
): Record<RepresentativeRole, ResolvedRepresentative> {
  const resolved = resolveRepresentativeImages(stampSet);
  for (const role of ["main", "tab"] as const) {
    const issue = describeRepresentativeIssue(role, resolved[role]);
    if (issue !== null) {
      throw new Error(issue);
    }
  }
  return resolved as Record<RepresentativeRole, ResolvedRepresentative>;
}

/** 編集中のセットを、ZIP出力条件とLINEアップロード条件に分けて検証する。 */
export function validateStampSet(stampSet: StampSet): StampSetValidation {
  const titleError = validateTitle(stampSet.title);
  const descriptionError = validateDescription(stampSet.description);
  const creatorNameError = validateCreatorName(stampSet.creatorName);
  const copyrightError = validateCopyright(stampSet.copyright);
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
  const representatives = resolveRepresentativeImages(stampSet);
  const representativeIssues = (["main", "tab"] as const)
    .map((role) => describeRepresentativeIssue(role, representatives[role]))
    .filter((issue): issue is string => issue !== null);

  const issues: string[] = [];
  if (titleError) issues.push(titleError.message);
  if (descriptionError) issues.push(descriptionError.message);
  if (creatorNameError) issues.push(creatorNameError.message);
  if (copyrightError) issues.push(copyrightError.message);
  if (!VALID_STAMP_COUNTS.has(stampSet.images.length)) {
    issues.push("スタンプ画像の枚数は8・16・24・32・40枚のいずれかにしてください。");
  }
  if (failedImages.length > 0) {
    issues.push(`変換が完了していない画像が${failedImages.length}枚あります。`);
  }
  if (invalidImages.length > 0) {
    issues.push(`LINE規格に適合していない画像が${invalidImages.length}枚あります。`);
  }
  issues.push(...representativeIssues);

  const representativesValid = representativeIssues.length === 0;
  const exportMetadataValid = titleError === null && descriptionError === null;
  const uploadMetadataValid =
    exportMetadataValid &&
    creatorNameError === null &&
    copyrightError === null;
  const canExport =
    exportMetadataValid && completedImages.length > 0 && representativesValid;
  const isValidForUpload =
    uploadMetadataValid &&
    VALID_STAMP_COUNTS.has(stampSet.images.length) &&
    failedImages.length === 0 &&
    invalidImages.length === 0 &&
    representativesValid;

  return { canExport, isValidForUpload, issues };
}

/** isValidForUploadを現在の内容から再計算した新しいStampSetを返す。 */
export function recalculateStampSet(stampSet: StampSet): StampSet {
  const validation = validateStampSet(stampSet);
  return { ...stampSet, isValidForUpload: validation.isValidForUpload };
}

/** 役割ごとに先頭の選択可能な画像IDを返す。新規作成・旧データの初回正規化専用。 */
export function firstSelectableImageId(
  images: StampImage[],
  role: RepresentativeRole,
): string | null {
  return images.find((image) => isSelectableRepresentative(image, role))?.id ?? null;
}

/**
 * 画像IDの欠落・重複を補い、選択フィールドを正規化する。
 * - IDのない旧画像には位置から作ったIDを付与する（以後は位置に依存しない）
 * - 選択フィールドが未指定（undefined）の場合だけ先頭の正常画像を選ぶ
 * - null や存在しないIDは補正せずに保持し、検証で知らせる
 */
export function normalizeStampSet(input: StampSetInput): StampSet {
  const used = new Set<string>();
  const images: StampImage[] = input.images.map((image, index) => {
    const base = image.id && image.id.length > 0 ? image.id : `stamp-${index}`;
    let id = base;
    for (let suffix = 2; used.has(id); suffix += 1) {
      id = `${base}-${suffix}`;
    }
    used.add(id);
    return { ...image, id };
  });
  return recalculateStampSet({
    ...input,
    images,
    mainImageId:
      input.mainImageId === undefined
        ? firstSelectableImageId(images, "main")
        : input.mainImageId,
    tabImageId:
      input.tabImageId === undefined
        ? firstSelectableImageId(images, "tab")
        : input.tabImageId,
  });
}

/** 生成画像から、セット内で安定した画像IDを決める（生成項目IDを優先）。 */
export function stampImageIdFor(generated: GeneratedImage): string {
  return generated.itemId && generated.itemId.length > 0
    ? generated.itemId
    : `stamp-${generated.index}`;
}

/**
 * 画像処理APIの結果を編集・アップロード用のStampImageへ変換する。
 * メイン・タブのプレビューは派生画像だけを使い、元画像へフォールバックしない。
 */
export function toStampImage(
  id: string,
  sourcePath: string,
  processed: ProcessedImageSet,
  fallbackPreviewUrl = "",
): StampImage {
  return {
    id,
    sourcePath,
    stampPath: processed.stampPath,
    mainImagePath: processed.mainImagePath,
    thumbnailPath: processed.thumbnailPath,
    stampPreviewUrl: processed.stampDataUrl || fallbackPreviewUrl,
    mainImagePreviewUrl: processed.mainImageDataUrl,
    thumbnailPreviewUrl: processed.thumbnailDataUrl,
    processingStatus: "done",
    validationResult: processed.validation,
  };
}

/** 変換失敗画像を位置を保ったまま編集画面へ残す。派生画像は未作成として扱う。 */
export function toFailedStampImage(
  id: string,
  generated: GeneratedImage,
  message: string,
): StampImage {
  return {
    id,
    sourcePath: generated.tempFilePath,
    stampPath: "",
    mainImagePath: "",
    thumbnailPath: "",
    stampPreviewUrl: generated.dataUrl,
    mainImagePreviewUrl: "",
    thumbnailPreviewUrl: "",
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
 * 失敗画像は再試行可能な状態でセット内へ残す。メイン・タブ画像は先頭の正常画像を初期選択する。
 */
export async function buildStampSetFromGeneratedImages(
  generatedImages: GeneratedImage[],
  processImage: (sourcePath: string) => Promise<ProcessedImageSet>,
): Promise<StampSetBuildResult> {
  const images: StampImage[] = [];
  let failedCount = 0;

  for (const generated of [...generatedImages].sort((a, b) => a.index - b.index)) {
    const id = stampImageIdFor(generated);
    if (generated.status !== "done" || !generated.tempFilePath) {
      failedCount += 1;
      images.push(
        toFailedStampImage(
          id,
          generated,
          generated.errorMessage ?? "生成画像が完成していないため変換できませんでした。",
        ),
      );
      continue;
    }

    try {
      const processed = await processImage(generated.tempFilePath);
      images.push(toStampImage(id, generated.tempFilePath, processed, generated.dataUrl));
    } catch (error) {
      failedCount += 1;
      const message =
        error instanceof Error && error.message
          ? error.message
          : "LINE規格への画像変換に失敗しました。";
      images.push(toFailedStampImage(id, generated, message));
    }
  }

  const stampSet = normalizeStampSet({
    title: "",
    description: "",
    creatorName: "",
    copyright: "",
    images,
    isValidForUpload: false,
  });
  return { stampSet, failedCount };
}
