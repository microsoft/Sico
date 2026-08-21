// 4-tier conversation timestamp: same day → `HH:mm`; day before → `Yesterday
// HH:mm`; earlier this year → `MM-DD HH:mm`; prior year → `YYYY-MM-DD HH:mm`.
// Native `Date` + `Intl.DateTimeFormat` only (moment is banned).

// `hourCycle: "h23"` (not `hour12: false`) pins midnight to "00:00" — `hour12:
// false` can surface "24:00" in some engines.
const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Local-time YYYY-MM-DD (NOT toISOString, which is UTC and would cross a day
// boundary for non-UTC viewers).
function localDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function localMonthDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${m}-${d}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatDateTime(value: number): string {
  const date = new Date(value);
  const time = TIME.format(date);

  const now = new Date();
  if (isSameLocalDay(date, now)) {
    return time;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) {
    return `Yesterday ${time}`;
  }

  // Earlier this calendar year → drop the year.
  if (date.getFullYear() === now.getFullYear()) {
    return `${localMonthDay(date)} ${time}`;
  }

  return `${localDate(date)} ${time}`;
}
