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

import { type ReactElement, useEffect, useState } from "react";

// Mirrors legacy SkillParsingPlaceholder: an indeterminate progress bar that
// eases toward 90% (it never reaches 100% until polling reports UPLOADED) plus
// an animated trailing ellipsis. Driven in JS so no global keyframes are needed.
export function ParsingProgress({ text }: { text: string }): ReactElement {
  const [progress, setProgress] = useState(0);
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => Math.min(90, prev + (100 - prev) * 0.02));
      setDots((prev) => (prev.length >= 3 ? "." : `${prev}.`));
    }, 250);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex h-17 flex-col items-center justify-center pb-6">
      <div className="inline-flex flex-col items-stretch gap-3">
        <span className="text-foreground-emphasis text-center text-base">
          {text} <span className="inline-block w-6 text-left">{dots}</span>
        </span>
        <div className="bg-progress-track-fill h-1 w-full overflow-hidden rounded-full">
          <div
            className="duration-medium-2 bg-progress-indicator-fill shadow-progress-glow ease-persistent h-full rounded-l-full transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
