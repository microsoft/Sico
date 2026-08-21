import { formatDateTime } from "./format-date-time";

// LAST ACTIVE timestamps reach this from two sources with DIFFERENT units:
// `project.updatedAt`/agent `updatedAt` are epoch MS, while per-member
// `rbacUser.updatedAt` is epoch SECONDS. Normalize by magnitude — anything
// below ~2001-in-ms (1e12) is a seconds value, so ×1000 — then defer to
// `formatDateTime` for the locale-stable `YYYY-MM-DD HH:mm` render (no
// browser-locale drift, so no CJK "年月日" output).
const SECONDS_MS_THRESHOLD = 1e12;

export function formatLastActive(value: number): string {
  const ms = value < SECONDS_MS_THRESHOLD ? value * 1000 : value;
  return formatDateTime(ms);
}
