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

import { type CSSProperties } from "react";

// Legacy ConversationStarter entrance, staggered so the hero, composer, and
// suggested-task block rise in sequence (0 / 120 / 240ms). The motion lives in
// the `animate-starter-reveal` / `animate-starter-fade` utilities (keyframes +
// 0.5s + the out-expo curve, defined in globals.css); only the per-block delay
// is inline. The utilities MUST be applied as classes — a pure inline
// `animation` would be tree-shaken by Tailwind's content scanner. Gated on
// `motion-safe:` so a reduced-motion user gets the final state with no movement
// (same accessibility contract as the login stagger).
export const REVEAL_CLASS = "motion-safe:animate-starter-reveal";
export const FADE_CLASS = "motion-safe:animate-starter-fade";

// Per-block stagger. An inline `animationDelay` longhand reliably wins over the
// utility's `animation` shorthand (same pattern as the login stagger).
export function delayStyle(delayMs: number): CSSProperties {
  return { animationDelay: `${delayMs}ms` };
}
