import type { MemberType } from "./schemas/project";

// `: MemberType` annotation fails compilation if `3` ever stops being a
// valid `MemberTypeSchema` value (see packages/shared/CLAUDE.md).
export const DEFAULT_PROJECT_MEMBER_TYPE: MemberType = 3;
export const DEFAULT_PROJECT_PAGE_SIZE = 50;

// Max DW avatars shown before collapsing the rest into a `+N` count.
// Shared by the project card and the project drawer so both truncate
// identically.
export const MAX_VISIBLE_AGENTS = 3;
