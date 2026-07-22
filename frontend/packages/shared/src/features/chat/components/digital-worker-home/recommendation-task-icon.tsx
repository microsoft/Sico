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

import {
  BookOpen,
  Brain,
  FileText,
  Hammer,
  SquareTerminal,
} from "lucide-react";
import { type JSX } from "react";

import { RecommendationTaskIconSchema } from "../../schemas/recommendation-task";

const { enum: Icon } = RecommendationTaskIconSchema;

// Maps a wire icon code to a lucide glyph (styling.md bans the legacy inline
// SVGs). Any unrecognized/future code — including UNKNOWN/FALLBACK — renders the
// console glyph, so a stray code degrades gracefully instead of throwing.
export function RecommendationTaskIconGlyph({
  icon,
}: {
  icon: number;
}): JSX.Element {
  switch (icon) {
    case Icon.BUILD:
      return <Hammer className="size-3.5" />;
    case Icon.THINK:
      return <Brain className="size-3.5" />;
    case Icon.WRITE:
      return <FileText className="size-3.5" />;
    case Icon.RESEARCH:
      return <BookOpen className="size-3.5" />;
    default:
      return <SquareTerminal className="size-3.5" />;
  }
}
