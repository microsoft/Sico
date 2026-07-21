import { z } from "zod";

// Wire integers from skills/models.ts SkillStatus. z.enum (TS enum is banned);
// access via SkillStatusSchema.enum.UPLOADED.
export const SkillStatusSchema = z.enum({
  UNKNOWN: 0,
  UPLOADING: 1,
  UPLOADED: 2,
  FAILED: 3,
});
export type SkillStatus = z.infer<typeof SkillStatusSchema>;

export const skillFileKindSchema = z.enum(["text", "image", "pdf", "binary"]);
export type SkillFileKind = z.infer<typeof skillFileKindSchema>;

export const skillFileSchema = z.object({
  path: z.string(),
  content: z.string().default(""),
  // Populated client-side when files are downloaded from version.url: `kind`
  // drives the preview branch, `bytes` carries the raw payload for
  // image/pdf/binary previews. Absent on backend-sourced inline files.
  kind: skillFileKindSchema.optional(),
  bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array).optional(),
});
export type SkillFile = z.infer<typeof skillFileSchema>;

export const skillActionSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  advancedSettings: z.string().default(""),
});
export type SkillAction = z.infer<typeof skillActionSchema>;

export const skillSummarySchema = z.object({
  id: z.number().int().safe(),
  agentId: z.string(),
  name: z.string(),
  description: z.string().default(""),
  version: z.string(),
  projectId: z.number().int().safe(),
  createdAt: z.number().int().nonnegative().safe(),
  updatedAt: z.number().int().nonnegative().safe(),
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

export const skillVersionSchema = z.object({
  id: z.number().int().safe(),
  skillId: z.number().int().safe(),
  version: z.string(),
  name: z.string(),
  description: z.string().default(""),
  // The open-source backend omits assetId on version objects; files live at
  // `url` and are downloaded client-side. Default so detail parsing succeeds.
  assetId: z.number().int().safe().default(0),
  url: z.string().default(""),
  creatorUsername: z.string().default(""),
  failReason: z.string().default(""),
  createdAt: z.number().int().nonnegative().safe(),
  updatedAt: z.number().int().nonnegative().safe(),
  files: z.array(skillFileSchema).default([]),
  actions: z
    .array(skillActionSchema)
    .nullish()
    .transform((value) => value ?? []),
});
export type SkillVersion = z.infer<typeof skillVersionSchema>;

export const skillItemSchema = z.object({
  id: z.number().int().safe(),
  agentId: z.string(),
  name: z.string(),
  description: z.string().default(""),
  version: z.string(),
  // The list endpoint omits status/assetId for already-parsed skills; a listed
  // skill is an existing, uploaded one, so default to UPLOADED and render the
  // normal card body. assetId is unused on the list item.
  status: SkillStatusSchema.default(SkillStatusSchema.enum.UPLOADED),
  assetId: z.number().int().safe().default(0),
  creatorUsername: z.string().default(""),
  failReason: z.string().default(""),
  projectId: z.number().int().safe(),
  createdAt: z.number().int().nonnegative().safe(),
  // The open-source backend sends updatedAt as a number, legacy as a string;
  // normalize to string. Unused downstream.
  updatedAt: z.union([z.string(), z.number()]).transform(String).default(""),
});
export type SkillItem = z.infer<typeof skillItemSchema>;

export const skillDetailSchema = z.object({
  skill: skillSummarySchema,
  versions: z.array(skillVersionSchema).default([]),
});
export type SkillDetail = z.infer<typeof skillDetailSchema>;
