// Absolute `YYYY-MM-DD HH:mm` over native `Intl` — no date library (§6).
// No `timeZone` so output follows the viewer's local zone (matching the chat
// timestamp formatter); `hourCycle: "h23"` avoids "24:00" at midnight on some
// ICU builds; `formatToParts` gives ISO order `format()` won't.
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDateTime(epochMs: number): string {
  const parts = dateTimeFormat.formatToParts(new Date(epochMs));
  // Look parts up by their typed `type` (not an Object.fromEntries map) so a
  // typo stays a compile error under `noUncheckedIndexedAccess`.
  const at = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${at("year")}-${at("month")}-${at("day")} ${at("hour")}:${at("minute")}`;
}
