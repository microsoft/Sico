// Auth zod schemas for `/api/sico/rbac/login`.
import { z } from "zod";

// A single role grant embedded in the login `user`. The backend changed this
// from a flat string list to structured grants (`{ id, roleCode, scopeType,
// scopeId }`, each scoped to a project/platform/org). No field is read today —
// project capabilities come from the `/rbac/user_roles` query — but the shape is
// parsed (not dropped) so the contract is captured; every field is tolerant
// (`.catch`) so an off-contract grant can't fail the whole login parse. Kept
// local to the auth schema (not the rbac `userRoleSchema`, which carries a
// `userId` the login payload omits).
export const userRoleGrantSchema = z.object({
  id: z.number().int().catch(0),
  roleCode: z.string(),
  scopeType: z.string().catch(""),
  scopeId: z.number().int().catch(0),
});
export type UserRoleGrant = z.infer<typeof userRoleGrantSchema>;

export const userSchema = z.object({
  // Backend `common.User.id` is `int64` — safe in JS up to 2^53.
  // See plan.md Task 1 contract debt note.
  id: z.number().int(),
  email: z.string().email(),
  // Avatar URL used in sidebar footer; backend may send "", a relative
  // path, or a full URL. Normalise "" to undefined so consumers can
  // branch on absence; don't validate URL shape (relative paths are
  // legitimate).
  iconUri: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  // Structured role grants. May arrive as JSON `null` (unassigned; sico backend
  // dogfood QA Round 1 FIND-1) or be omitted entirely (DWP's backend sends no
  // `roles` field). `nullish` accepts both; coerce to `[]` so consumers can call
  // array methods without null/undefined checks.
  roles: z
    .array(userRoleGrantSchema)
    .nullish()
    .transform((v) => v ?? []),
});

export const loginResponseSchema = z.object({
  tokenInfo: z.object({
    accessToken: z.string(),
    // Epoch-seconds (backend `time.Unix()`). Upper bound catches
    // accidental millisecond payloads from older mocks.
    expiresAt: z.number().int().positive().max(2_000_000_000, {
      message:
        "expiresAt must be epoch-seconds; a 13-digit ms value would expire ~33000 years from now",
    }),
  }),
  user: userSchema,
});

export type User = z.infer<typeof userSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const registerNewUserResponseSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().min(1)]),
});

export type RegisterNewUserResponse = z.infer<
  typeof registerNewUserResponseSchema
>;
