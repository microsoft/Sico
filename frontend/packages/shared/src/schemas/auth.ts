/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Auth zod schemas for `/api/sico/rbac/login`.
import { z } from "zod";

// A single role grant on the login user: a role code scoped to a resource
// (`scopeType` + `scopeId`). The backend serialises `common.UserRoleInfo`.
export const userRoleSchema = z.object({
  // int64 role-grant id — safe in JS up to 2^53.
  id: z.number().int(),
  roleCode: z.string(),
  scopeType: z.string(),
  // int64 scope id (e.g. the project id for a project-scoped role).
  scopeId: z.number().int(),
});
export type UserRole = z.infer<typeof userRoleSchema>;

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
  // Scoped role grants (`common.UserRoleInfo`). An unassigned slice may arrive
  // as JSON `null` (backend serialises an empty slice as null) or be omitted
  // entirely; `nullish` accepts both and coerces to `[]` so consumers can call
  // array methods without null/undefined checks.
  roles: z
    .array(userRoleSchema)
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
