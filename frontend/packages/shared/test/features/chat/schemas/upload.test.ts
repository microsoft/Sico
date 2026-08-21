import { describe, expect, it } from "vitest";

import { uploadEnvelopeSchema } from "@/features/chat/schemas/upload";

describe("uploadEnvelopeSchema", () => {
  it("parses a successful upload envelope", () => {
    const result = uploadEnvelopeSchema.safeParse({
      code: 0,
      msg: "ok",
      data: {
        id: 5,
        metaInfo: {
          contentType: "application/pdf",
          fileExt: "pdf",
          fileName: "a.pdf",
          fileSize: 10,
          fileType: "pdf",
        },
        sasUrl: "https://blob/sas",
        uri: "asset://a",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when inner data omits uri", () => {
    const result = uploadEnvelopeSchema.safeParse({
      code: 0,
      msg: "ok",
      data: { id: 5, metaInfo: {}, sasUrl: "s" },
    });
    expect(result.success).toBe(false);
  });
});
