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

// Page size for `/digital-worker` infinite query.
// Sidebar consumes the same cache and reads only the first page.
export const DEFAULT_AGENTS_PAGE_SIZE = 30;

// `isEmployer=false` filters to the operator's own DWs (vs employer view).
// All in-app consumers (dashboard + sidebar) use the same value, so it's
// fixed at module scope rather than passed through every call.
export const DEFAULT_AGENTS_IS_EMPLOYER = false;

// Preset DW avatars — the 18 illustrated portraits from the SICO design system
// ("Avatar Selection Grid", Figma node 11706-53487), pre-uploaded to the DWP
// asset CDN. Stored as the backend `uri` (relative blob path, NOT the full
// URL): the create endpoint expects the relative path and echoes back a
// resolved full URL in `iconUri` — sending a full URL makes it return an empty
// `iconUri`, so the avatar wouldn't render. `dwAvatarUrl()` builds the display
// URL for the picker. Order mirrors the design grid (row-major, 6×3).
const DW_AVATAR_CDN_BASE =
  "https://dwp-cdn-ddcqh0dkgnhbchgs.b01.azurefd.net/test/";

// `as const` (not a `readonly string[]` annotation) so TS keeps the non-empty
// tuple type — `DW_AVATAR_PRESETS[0]` is then provably `string`, avoiding a
// non-null assertion at the default-avatar seed sites. Assets are trimmed to
// the portrait circle (the raw exports had a ~3px white margin that showed as a
// ring inside the round Avatar).
export const DW_AVATAR_PRESETS = [
  "default_space/7661735044905435136.png",
  "default_space/7661735044892852224.png",
  "default_space/7661735044901240832.png",
  "default_space/7661735044934795264.png",
  "default_space/7661735044926406656.png",
  "default_space/7661735044884463616.png",
  "default_space/7661735051360468992.png",
  "default_space/7661735048449622016.png",
  "default_space/7661735051435982848.png",
  "default_space/7661735051435966464.png",
  "default_space/7661735051473715200.png",
  "default_space/7661735051519852544.png",
  "default_space/7661735054938210304.png",
  "default_space/7661735058029412352.png",
  "default_space/7661735057962303488.png",
  "default_space/7661735058012635136.png",
  "default_space/7661735057974886400.png",
  "default_space/7661735058180407296.png",
] as const;

// Full display URL for a preset `uri` (relative blob path). The picker shows
// these; the create request still sends the relative `uri`.
export function dwAvatarUrl(uri: string): string {
  return `${DW_AVATAR_CDN_BASE}${uri}`;
}
