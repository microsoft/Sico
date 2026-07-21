import { z } from "zod";

// URL-persisted assets-table state (§9 B): the asc/desc sort and the free-text
// search. Defaults keep an empty URL valid (newest first · no query). The active
// category is not here — it lives in the route path (see `AssetCategory` in
// `../types`).
export const assetSearchSchema = z.object({
  sort: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().default(""),
});
export type AssetSearch = z.infer<typeof assetSearchSchema>;
