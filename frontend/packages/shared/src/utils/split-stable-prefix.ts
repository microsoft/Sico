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

// Streaming-render boundary (§6.E7c): split growing `content` into a settled
// prefix (safe to memoize) and a live tail (re-parsed each SSE frame). Since
// fence-safety is a prefix property, one forward pass tracking fence state finds
// the last blank line outside any open fence — the safe split point.
export function splitStablePrefix(content: string): number {
  let fenceChar: "`" | "~" | null = null;
  let boundary = 0;
  let lineStart = 0;

  for (let i = 0; i <= content.length; i++) {
    if (i !== content.length && content[i] !== "\n") {
      continue;
    }
    const line = content.slice(lineStart, i);
    const opener = line.trimStart();
    if (fenceChar === null) {
      if (opener.startsWith("```")) {
        fenceChar = "`";
      } else if (opener.startsWith("~~~")) {
        fenceChar = "~";
      }
    } else if (opener.startsWith(fenceChar.repeat(3))) {
      fenceChar = null;
    }
    // A blank line that sits OUTSIDE any open fence settles every block before
    // it; the prefix through this blank line's newline is the new safe boundary.
    if (fenceChar === null && line.trim() === "" && i < content.length) {
      boundary = i + 1;
    }
    lineStart = i + 1;
  }
  return boundary;
}
