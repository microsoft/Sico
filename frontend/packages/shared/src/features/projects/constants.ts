import type { MemberType } from "./schemas/project";

// `: MemberType` annotation fails compilation if `3` ever stops being a
// valid `MemberTypeSchema` value (see packages/shared/CLAUDE.md).
export const DEFAULT_PROJECT_MEMBER_TYPE: MemberType = 3;
export const DEFAULT_PROJECT_PAGE_SIZE = 50;

// Max DW avatars shown before collapsing the rest into a `+N` count.
// Shared by the project card and the project drawer so both truncate
// identically.
export const MAX_VISIBLE_AGENTS = 3;

// PR313 section heading — uppercase eyebrow shared by the project drawer
// (Members/Sandbox/Knowledge tags) and the asset-detail panel so both drawers
// carry one source of truth for the section-label style.
export const SECTION_TITLE_CLASS =
  "text-foreground-secondary text-xs font-medium tracking-wider uppercase";

// The drawer's "View all" link-CTA style (Sandbox + Knowledge sections): a
// muted link + trailing chevron, no underline. One source so the sections stay
// visually identical.
export const DRAWER_LINK_CTA_CLASS =
  "text-foreground-secondary hover:text-foreground-primary active:text-foreground-primary h-auto gap-1 self-start p-0 text-sm font-normal no-underline hover:no-underline [&_svg]:size-4";
