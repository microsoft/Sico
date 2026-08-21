import emptyCardsUrl from "../assets/empty-cards.svg";
import emptyPeopleUrl from "../assets/empty-people.svg";
import emptyProjectsUrl from "../assets/empty-projects.svg";
import emptySkillsUrl from "../assets/empty-skills.svg";
import noPreviewUrl from "../assets/no-preview.svg";

export type IllustrationAsset = {
  url: string;
  width: number;
  height: number;
};

/**
 * The empty / blocked illustrations, keyed by their VISUAL STYLE (not by
 * feature), each pinned with its intrinsic size so every `MessageState` renders
 * it identically and the asset + dimensions can't drift across call sites.
 * Feature empty states pick a style by key instead of importing an SVG directly,
 * which also keeps the shared assets out of feature `assets/` dirs (Promotion
 * rule — an asset with a 2nd consumer belongs at the shared top level).
 *
 * - `people`    — three stacked avatar cards (person / digital-worker lists)
 * - `cards`     — empty list cards (tables, app / device lists)
 * - `projects`  — the projects empty scene
 * - `skills`    — the skills / training empty scene
 * - `noPreview` — the "can't preview this file" file window
 */
export type EmptyIllustration =
  | "people"
  | "cards"
  | "projects"
  | "skills"
  | "noPreview";

export const EMPTY_ILLUSTRATIONS = {
  people: { url: emptyPeopleUrl, width: 218, height: 159 },
  cards: { url: emptyCardsUrl, width: 200, height: 140 },
  projects: { url: emptyProjectsUrl, width: 186, height: 146 },
  skills: { url: emptySkillsUrl, width: 186, height: 136 },
  noPreview: { url: noPreviewUrl, width: 160, height: 140 },
} as const satisfies Record<EmptyIllustration, IllustrationAsset>;
