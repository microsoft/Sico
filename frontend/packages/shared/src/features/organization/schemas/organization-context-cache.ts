import { z } from "zod";

import { organizationSummarySchema } from "./organization";

export const organizationContextOrganizationsSchema = z.array(
  organizationSummarySchema.extend({ id: z.number().int().positive().safe() }),
);

export const organizationContextCacheSchema = z.object({
  version: z.literal(1),
  userId: z.number().int().positive().safe(),
  organizations: organizationContextOrganizationsSchema.nonempty(),
});
