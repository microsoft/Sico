import { describe, expect, it } from "vitest";

import {
  DEFAULT_SKILLS_PAGE_SIZE,
  MAX_SKILL_FILES,
  MAX_UPDATE_FILES,
  SKILL_ACCEPT_EXTENSIONS,
  SKILL_POLL_INTERVAL_MS,
  SKILL_POLL_MAX_ATTEMPTS,
} from "@/features/skill/constants";

describe("skill constants", () => {
  it("limits create uploads to 5 and replace uploads to 1", () => {
    expect(MAX_SKILL_FILES).toBe(5);
    expect(MAX_UPDATE_FILES).toBe(1);
  });
  it("accepts only zip/md/skill", () => {
    expect(SKILL_ACCEPT_EXTENSIONS).toEqual(["zip", "md", "skill"]);
  });
  it("polls every 5s with a bounded attempt cap", () => {
    expect(SKILL_POLL_INTERVAL_MS).toBe(5000);
    expect(SKILL_POLL_MAX_ATTEMPTS).toBeGreaterThan(0);
  });
  it("loads skills with a fixed page size", () => {
    expect(DEFAULT_SKILLS_PAGE_SIZE).toBe(100);
  });
});
