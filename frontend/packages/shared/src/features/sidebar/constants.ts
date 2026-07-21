// Max agents previewed under the DW group in both expanded and collapsed modes.
// Also reused as the pending-skeleton row count in both modes so the placeholder
// density matches the steady-state row cap exactly — zero layout shift on
// data arrival.
export const DW_PREVIEW = 5;

// The interactive nav-row color palette (rest / hover / active), shared by every
// full-width text nav row — NavRow, DwList's agent rows, and the DW conversation
// rows. Extracted so a token change lands in ONE place: this exact fragment was
// hand-inlined in four files and had to be re-tokenized in lockstep, which lint
// can't police (a missed copy = silent visual drift). Layout classes (height,
// gap, padding) stay per-row since they differ (h-9 vs h-8). The icon-only rail
// rows use a deliberate subset (no foreground shifts) and don't compose this.
export const NAV_ROW_STATE =
  "text-foreground-secondary hover:bg-surface-muted hover:text-foreground-primary data-[active]:bg-surface-muted data-[active]:text-foreground-emphasis";
