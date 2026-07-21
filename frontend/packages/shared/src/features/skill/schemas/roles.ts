import { z } from "zod";

export const roleSchema = z.object({
  name: z.string(),
  value: z.string(),
});
export type Role = z.infer<typeof roleSchema>;

// Backend (legacy `dwp/agent/roles` parity) returns `{ role: string[] }` — a
// bare list of role names. Map each name to a {name, value} pair so hooks and
// the Select consume a uniform Role[] (name === value, as the legacy Dropdown
// used the same string for both).
export const rolesPayloadSchema = z
  .object({ role: z.array(z.string()).default([]) })
  .transform(({ role }): Role[] =>
    role.map((name): Role => ({ name, value: name })),
  );
