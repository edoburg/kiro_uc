import { describe, expect, it, vi } from "vitest";

import type {
  GeneratedImage,
  ProcessedImageSet,
  StampImage,
  StampSet,
  StampSetInput,
} from "../types/index";
import { appReducer, initialAppState, type AppState } from "../stores/appStore";
import {
  buildStampSetFromGeneratedImages,
  normalizeStampSet,
  recalculateStampSet,
  resolveRepresentativeImages,
  toStampImage,
  validateStampSet,
} from "../utils/stampSet";

function processed(index: number | string): ProcessedImageSet {
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
  return toStampImage(`item-${index}`, `C:/tmp/${index}.png`, processed(index));
}

function stampSet(count = 8): StampSet {
  return recalculateStampSet({
    title: "有効なタイトル",
    description: "説明",
    creatorName: "テスト作者",
    copyright: "© Test Creator",
    images: Array.from({ length: count }, (_, index) => stampImage(index)),
    mainImageId: "item-0",
    tabImageId: "item-0",
    isValidForUpload: false,
  });
}

function editState(set: StampSet = stampSet(8)): AppState {
  return { ...initialAppState, stampSet: set, step: "edit" };
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

  it("生成項目IDを画像IDに引き継ぎ、先頭の正常画像をメイン・タブの初期値にする", async () => {
    const generated: GeneratedImage[] = [0, 1, 2].map((index) => ({
      index,
      itemId: `daily-${index}`,
      dataUrl: `preview${index}`,
      tempFilePath: `${index}.png`,
      status: "done",
    }));
    const processImage = vi.fn(async (path: string) => {
      if (path === "0.png") throw new Error("変換エラー");
      return processed(Number(path[0]));
    });

    const { stampSet: built } = await buildStampSetFromGeneratedImages(generated, processImage);

    expect(built.images.map((image) => image.id)).toEqual(["daily-0", "daily-1", "daily-2"]);
    // 変換失敗の先頭画像は選ばない
    expect(built.mainImageId).toBe("daily-1");
    expect(built.tabImageId).toBe("daily-1");
    // 失敗画像のメイン／タブ欄に元画像を派生画像として表示しない
    expect(built.images[0].mainImagePreviewUrl).toBe("");
    expect(built.images[0].thumbnailPreviewUrl).toBe("");
  });

  it("派生画像のプレビューURLがない場合も元画像へフォールバックしない", () => {
    const image = toStampImage("item-0", "src.png", {
      ...processed(0),
      mainImageDataUrl: "",
      thumbnailDataUrl: "",
    }, "data:image/png;base64,original");

    expect(image.stampPreviewUrl).toBe("data:image/png;base64,stamp0");
    expect(image.mainImagePreviewUrl).toBe("");
    expect(image.thumbnailPreviewUrl).toBe("");
  });
});

describe("旧データの初回正規化", () => {
  it("IDと選択フィールドのない旧データだけ先頭の正常画像へフォールバックする", () => {
    const legacy: StampSetInput = {
      ...stampSet(3),
      images: stampSet(3).images.map((image) => {
        const copy: Partial<StampImage> = { ...image };
        delete copy.id;
        return copy as Omit<StampImage, "id">;
      }),
    };
    delete legacy.mainImageId;
    delete legacy.tabImageId;

    const normalized = normalizeStampSet(legacy);

    expect(normalized.images.map((image) => image.id)).toEqual(["stamp-0", "stamp-1", "stamp-2"]);
    expect(normalized.mainImageId).toBe("stamp-0");
    expect(normalized.tabImageId).toBe("stamp-0");
  });

  it("明示された未選択・不正IDは先頭へ補正しない", () => {
    const normalized = normalizeStampSet({ ...stampSet(3), mainImageId: null, tabImageId: "missing" });

    expect(normalized.mainImageId).toBeNull();
    expect(normalized.tabImageId).toBe("missing");
    const validation = validateStampSet(normalized);
    expect(validation.canExport).toBe(false);
    expect(validation.isValidForUpload).toBe(false);
    expect(validation.issues).toContain(
      "メイン画像が選択されていません。一覧から「メイン画像に使う」を選んでください。",
    );
    expect(validation.issues).toContain(
      "選択中のタブ画像がスタンプセット内に見つかりません。一覧から選び直してください。",
    );
  });

  it("SET_STAMP_SETは同じ正規化を使う", () => {
    const next = appReducer(initialAppState, {
      type: "SET_STAMP_SET",
      stampSet: { ...stampSet(3), mainImageId: undefined, tabImageId: "item-2" },
    });

    expect(next.stampSet?.mainImageId).toBe("item-0");
    expect(next.stampSet?.tabImageId).toBe("item-2");
  });
});

describe("メイン／タブ画像の選択", () => {
  it("メインに3枚目、タブに5枚目を独立して選べる", () => {
    let state = editState();
    state = appReducer(state, { type: "SELECT_REPRESENTATIVE_IMAGE", role: "main", imageId: "item-2" });
    state = appReducer(state, { type: "SELECT_REPRESENTATIVE_IMAGE", role: "tab", imageId: "item-4" });

    const resolved = resolveRepresentativeImages(state.stampSet!);
    expect(resolved.main).toMatchObject({ status: "ok", index: 2, path: "C:/tmp/2_main.png" });
    expect(resolved.tab).toMatchObject({ status: "ok", index: 4, path: "C:/tmp/4_thumb.png" });
    expect(state.stampSet?.images.map((image) => image.stampPath)).toEqual(
      stampSet(8).images.map((image) => image.stampPath),
    );
    expect(state.stampSet?.isValidForUpload).toBe(true);
  });

  it("同じ画像をメインとタブの両方に使える", () => {
    const state = appReducer(editState(), {
      type: "SELECT_REPRESENTATIVE_IMAGE",
      role: "tab",
      imageId: "item-0",
    });
    expect(state.stampSet?.mainImageId).toBe("item-0");
    expect(state.stampSet?.tabImageId).toBe("item-0");
  });

  it("変換失敗・変換中・存在しない画像は選択できず、状態を変えない", () => {
    const set = stampSet(8);
    set.images[1] = { ...set.images[1], processingStatus: "error" };
    set.images[2] = { ...set.images[2], processingStatus: "processing" };
    const current = editState(set);

    for (const imageId of ["item-1", "item-2", "missing"]) {
      expect(
        appReducer(current, { type: "SELECT_REPRESENTATIVE_IMAGE", role: "main", imageId }),
      ).toBe(current);
    }
  });

  it("差し替え・再変換後も枠IDを維持し、新しい派生画像を参照する", () => {
    let state = appReducer(editState(), {
      type: "SELECT_REPRESENTATIVE_IMAGE",
      role: "main",
      imageId: "item-2",
    });
    state = appReducer(state, {
      type: "START_STAMP_IMAGE_PROCESSING",
      imageId: "item-2",
      sourcePath: "C:/tmp/replacement.png",
    });
    // 変換中は出力に使えない
    expect(resolveRepresentativeImages(state.stampSet!).main.status).toBe("unavailable");
    expect(validateStampSet(state.stampSet!).canExport).toBe(false);

    state = appReducer(state, {
      type: "UPDATE_STAMP_IMAGE",
      imageId: "item-2",
      // 別IDで作られた結果でも対象枠のIDを維持する
      image: toStampImage("other", "C:/tmp/replacement.png", processed("replacement")),
    });

    expect(state.stampSet?.images[2].id).toBe("item-2");
    expect(state.stampSet?.mainImageId).toBe("item-2");
    expect(resolveRepresentativeImages(state.stampSet!).main).toMatchObject({
      status: "ok",
      path: "C:/tmp/replacement_main.png",
      previewUrl: "data:image/png;base64,mainreplacement",
    });
  });

  it("選択画像の再変換が失敗したら選択を保持したまま出力を無効化する", () => {
    let state = appReducer(editState(), {
      type: "SELECT_REPRESENTATIVE_IMAGE",
      role: "tab",
      imageId: "item-4",
    });
    state = appReducer(state, {
      type: "STAMP_IMAGE_PROCESS_FAILED",
      imageId: "item-4",
      message: "変換エラー",
    });

    expect(state.stampSet?.tabImageId).toBe("item-4");
    const validation = validateStampSet(state.stampSet!);
    expect(validation.canExport).toBe(false);
    expect(validation.issues).toContain(
      "タブ画像に選択したスタンプ 5 は変換に失敗しています。再試行するか別の画像を選んでください。",
    );
  });

  it("選択中の画像を削除すると未選択に戻し、別画像へ切り替えない", () => {
    let state = appReducer(editState(), {
      type: "SELECT_REPRESENTATIVE_IMAGE",
      role: "main",
      imageId: "item-2",
    });
    state = appReducer(state, { type: "SELECT_REPRESENTATIVE_IMAGE", role: "tab", imageId: "item-4" });
    state = appReducer(state, { type: "DELETE_STAMP_IMAGE", imageId: "item-2" });

    expect(state.stampSet?.images).toHaveLength(7);
    expect(state.stampSet?.mainImageId).toBeNull();
    // 削除で位置がずれても、タブ画像は同じIDの画像を指し続ける
    expect(state.stampSet?.tabImageId).toBe("item-4");
    expect(resolveRepresentativeImages(state.stampSet!).tab).toMatchObject({
      status: "ok",
      index: 3,
      path: "C:/tmp/4_thumb.png",
    });
    const validation = validateStampSet(state.stampSet!);
    expect(validation.canExport).toBe(false);
    expect(state.stampSet?.isValidForUpload).toBe(false);

    state = appReducer(state, { type: "SELECT_REPRESENTATIVE_IMAGE", role: "main", imageId: "item-5" });
    expect(validateStampSet(state.stampSet!).canExport).toBe(true);
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

  it("クリエイター名とコピーライトはアップロードに必須だがZIP出力には影響しない", () => {
    const incomplete = stampSet(8);
    incomplete.creatorName = "";
    incomplete.copyright = "";

    const result = validateStampSet(incomplete);

    expect(result.canExport).toBe(true);
    expect(result.isValidForUpload).toBe(false);
    expect(result.issues).toContain("クリエイター名を入力してください");
    expect(result.issues).toContain("コピーライトを入力してください");
  });

  it("画像処理中はreducerがアップロード可否を再計算する", () => {
    const next = appReducer(editState(), {
      type: "START_STAMP_IMAGE_PROCESSING",
      imageId: "item-0",
      sourcePath: "replacement.png",
    });

    expect(next.stampSet?.images[0].processingStatus).toBe("processing");
    expect(next.stampSet?.isValidForUpload).toBe(false);
  });
});
