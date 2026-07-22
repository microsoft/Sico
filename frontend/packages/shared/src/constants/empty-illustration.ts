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
