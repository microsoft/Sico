// Upload caps mirror legacy UploadSkillsDialog (create up to 5, replace 1).
export const MAX_SKILL_FILES = 5;
export const MAX_UPDATE_FILES = 1;

// Legacy ACCEPT list. Extension match is case-insensitive at the call site.
export const SKILL_ACCEPT_EXTENSIONS = ["zip", "md", "skill"] as const;

// Legacy upload cap: each file must be <= 10MB.
export const MAX_SKILL_FILE_SIZE_MB = 10;

// Status polling: legacy used a fixed 5s interval with no cap. We keep the
// interval but bound attempts so a stuck "Parsing" surfaces a parse-error
// state instead of polling forever (design section 6 E5).
export const SKILL_POLL_INTERVAL_MS = 5000;
export const SKILL_POLL_MAX_ATTEMPTS = 60;

// Legacy loaded skills with page:1, pageSize:100. Skill counts per worker are
// small; one page is enough (no infinite scroll for skills).
export const DEFAULT_SKILLS_PAGE_SIZE = 100;

// Page size for the setup SKILL section's infinite query. Shared by the route
// loader prefetch, the page-level suspense gate, and the section itself so all
// three resolve to the same infinite query key and hit the same cache entry
// (avoids duplicate /skills/list requests).
export const SETUP_SKILLS_PAGE_SIZE = 10;
