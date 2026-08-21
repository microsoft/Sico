import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";

// Shared "this file can't be previewed" copy + illustration, used by every
// viewer that falls back to a download/unsupported state (pdf, glb, markdown-file
// load failure, and the unknown-subtype UnsupportedViewer). Kept in one place so
// a copy edit can't silently diverge across the call sites.
export const UNPREVIEWABLE_COPY = {
  heading: "Preview not supported for this file type.",
  body: "Download the file to view its contents.",
} as const;

// The shared no-preview illustration + its intrinsic size. Sourced from the
// shared illustration registry (the `noPreview` style) so the asset can't drift
// across call sites.
export const UNPREVIEWABLE_ILLUSTRATION = EMPTY_ILLUSTRATIONS.noPreview;
