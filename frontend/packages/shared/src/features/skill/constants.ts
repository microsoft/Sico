/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
