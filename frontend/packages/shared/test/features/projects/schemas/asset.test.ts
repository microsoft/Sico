import { describe, expect, it } from "vitest";

import {
  documentDetailsSchema,
  DocumentTypeSchema,
  ExtractionStatusSchema,
  knowledgeDocumentWireSchema,
  playbookDetailsSchema,
  playbookWireSchema,
  uploadArtifactSchema,
} from "@/features/projects/schemas/asset";

describe("ExtractionStatusSchema", () => {
  it("accepts the four numeric wire values", () => {
    expect(ExtractionStatusSchema.parse(0)).toBe(0); // UNKNOWN
    expect(ExtractionStatusSchema.parse(1)).toBe(1); // FAILED
    expect(ExtractionStatusSchema.parse(2)).toBe(2); // UPLOADED
    expect(ExtractionStatusSchema.parse(3)).toBe(3); // INGESTED
  });
  it("rejects the string name (wire is the integer, §8 C)", () => {
    expect(() => ExtractionStatusSchema.parse("INGESTED")).toThrow();
  });
});

describe("DocumentTypeSchema", () => {
  it("accepts FILE=1 and LINK=2", () => {
    expect(DocumentTypeSchema.parse(1)).toBe(1);
    expect(DocumentTypeSchema.parse(2)).toBe(2);
  });
  it("rejects the string name and out-of-range numbers (wire is the integer)", () => {
    expect(() => DocumentTypeSchema.parse("FILE")).toThrow();
    expect(() => DocumentTypeSchema.parse(3)).toThrow();
  });
});

describe("knowledgeDocumentWireSchema", () => {
  const fileRow = {
    id: 10,
    name: "spec.pdf",
    documentType: 1,
    status: 3,
    failReason: null,
    tags: [{ id: 1, name: "billing" }],
    assetId: 99,
    sourceFile: "spec.pdf",
    linkUrl: null,
    creatorUsername: "alice",
    createdAt: 1700000000000,
  };

  it("parses a full document row", () => {
    const doc = knowledgeDocumentWireSchema.parse(fileRow);
    expect(doc.documentType).toBe(1);
    expect(doc.status).toBe(3);
    expect(doc.tags).toEqual([{ id: 1, name: "billing" }]);
    expect(doc.creatorUsername).toBe("alice");
  });

  it("keeps linkUrl on a documentType:2 (LINK) row", () => {
    const linkRow = {
      ...fileRow,
      id: 11,
      documentType: 2,
      assetId: null,
      sourceFile: null,
      linkUrl: "https://example.com/doc",
    };
    expect(knowledgeDocumentWireSchema.parse(linkRow).linkUrl).toBe(
      "https://example.com/doc",
    );
  });

  it("carries failReason on a status:1 (FAILED) row", () => {
    const failedRow = { ...fileRow, status: 1, failReason: "extraction error" };
    expect(knowledgeDocumentWireSchema.parse(failedRow).failReason).toBe(
      "extraction error",
    );
  });

  it("defaults tags to [] when absent", () => {
    const { tags, ...rest } = fileRow;
    void tags;
    expect(knowledgeDocumentWireSchema.parse(rest).tags).toEqual([]);
  });

  it("coerces tags: null to [] (Go marshals an empty slice as null, §8 C)", () => {
    expect(
      knowledgeDocumentWireSchema.parse({ ...fileRow, tags: null }).tags,
    ).toEqual([]);
  });
});

describe("documentDetailsSchema", () => {
  it("parses summary + fullText", () => {
    const details = documentDetailsSchema.parse({
      summary: "a short summary",
      fullText: "the full extracted body",
    });
    expect(details.summary).toBe("a short summary");
    expect(details.fullText).toBe("the full extracted body");
  });
});

describe("playbookWireSchema", () => {
  const baseRow = {
    id: 5,
    name: "refund playbook",
    projectId: 1,
    agentInstanceId: 42,
    tags: [{ id: 7, name: "ops" }],
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
  };

  it("parses a LIST row carrying extraInfo.agentInstance (name + icon)", () => {
    const playbook = playbookWireSchema.parse({
      ...baseRow,
      extraInfo: {
        agentInstance: { agentName: "Max", agentIconUrl: "/icons/max.svg" },
      },
    });
    expect(playbook.agentInstanceId).toBe(42);
    expect(playbook.extraInfo?.agentInstance?.agentName).toBe("Max");
  });

  it("parses the human operatorUsername nested in extraInfo.agentInstance", () => {
    const playbook = playbookWireSchema.parse({
      ...baseRow,
      extraInfo: {
        agentInstance: {
          agentName: "Max",
          agentIconUrl: "/icons/max.svg",
          operatorUsername: "operator@sico.local",
        },
      },
    });
    expect(playbook.extraInfo?.agentInstance?.operatorUsername).toBe(
      "operator@sico.local",
    );
  });

  it("parses a SINGLE-row detail with no extraInfo (the field is optional)", () => {
    const playbook = playbookWireSchema.parse(baseRow);
    expect(playbook.agentInstanceId).toBe(42);
    expect(playbook.extraInfo).toBeUndefined();
    expect(playbook).not.toHaveProperty("creatorUsername");
  });

  it("defaults tags to [] when absent (parsed but not consumed)", () => {
    const playbook = playbookWireSchema.parse({
      id: 6,
      name: "no tags",
      projectId: 1,
      agentInstanceId: 43,
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    });
    expect(playbook.tags).toEqual([]);
  });

  it("coerces tags: null to [] so the Experience list never throws (§8 C)", () => {
    const playbook = playbookWireSchema.parse({
      id: 7,
      name: "null tags",
      projectId: 1,
      agentInstanceId: 44,
      tags: null,
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    });
    expect(playbook.tags).toEqual([]);
  });
});

describe("playbookDetailsSchema", () => {
  it("parses content + name", () => {
    const details = playbookDetailsSchema.parse({
      content: "# Refund steps\n1. ...",
      name: "refund playbook",
    });
    expect(details.content).toBe("# Refund steps\n1. ...");
    expect(details.name).toBe("refund playbook");
  });
});

describe("uploadArtifactSchema", () => {
  it("parses the POST /project/asset artifact (id, sasUrl, uri, metaInfo)", () => {
    const artifact = uploadArtifactSchema.parse({
      id: 99,
      sasUrl: "https://blob.example/abc?sig=x",
      uri: "project/1/abc.pdf",
      metaInfo: {
        contentType: "application/pdf",
        fileExt: "pdf",
        fileName: "abc.pdf",
        fileSize: 1024,
        fileType: "document",
      },
    });
    expect(artifact.id).toBe(99);
    expect(artifact.uri).toBe("project/1/abc.pdf");
    expect(artifact.metaInfo.fileName).toBe("abc.pdf");
  });
});
