import { describe, expect, it } from "vitest";

import type { StampSet } from "../types/index";
import { toUploadStartRequest } from "../utils/ipcMappers";

function makeStampSet(): StampSet {
  return {
    title: "テストセット",
    description: "説明",
    images: [
      {
        stampPath: "C:/tmp/stamp.png",
        mainImagePath: "C:/tmp/main.png",
        thumbnailPath: "C:/tmp/thumb.png",
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
  it("StampSetを余分なフィールドのないcamelCaseアップロード要求へ変換する", () => {
    const request = toUploadStartRequest(makeStampSet());

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
});
