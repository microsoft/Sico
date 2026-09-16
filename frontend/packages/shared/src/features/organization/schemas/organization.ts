import { z } from "zod";

import { OrganizationRoleCodeSchema } from "../../rbac/schemas/user-role";

const organizationBaseSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  iconUrl: z.string().nullish(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const organizationSummarySchema = organizationBaseSchema.extend({
  creatorUsername: z.string(),
  roleCodes: z.array(OrganizationRoleCodeSchema),
  isOwner: z.boolean(),
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const organizationDetailSchema = organizationBaseSchema;
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;
