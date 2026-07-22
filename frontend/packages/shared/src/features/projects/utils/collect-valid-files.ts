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

// Client-side upload gate (§5). The Add Knowledge dialog — NOT the input's
// `accept` — is the authoritative validator: a drag-drop or a programmatic
// `change` bypasses `accept`, so type/size/count are all re-checked here.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".xlsx"] as const;

// Identity of a picked file: same name + size + mtime ⇒ the same physical file.
// This is BOTH the dedupe key here and the React list key in the dialog — one
// function so the two can never drift (a mismatch is what lets a duplicate slip
// past dedupe yet collide as a React key).
export function fileKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

/**
 * Pure file validator: walks `incoming` in order applying the dedupe → type →
 * size → count gates, returning the accepted files plus an ordered list of
 * per-file error messages to toast. Files already in `existing` (or repeated
 * within the batch) are skipped SILENTLY — re-picking a file is not an error.
 * Dedupe runs before the count gate so a duplicate never consumes a slot, and
 * the running counter seeds from `existing.length` so a batch can't exceed
 * MAX_FILES across calls.
 */
export function collectValidFiles(
  incoming: File[],
  existing: File[],
): { accepted: File[]; errors: string[] } {
  const accepted: File[] = [];
  const errors: string[] = [];
  const seen = new Set(existing.map(fileKey));
  let count = existing.length;
  for (const file of incoming) {
    if (seen.has(fileKey(file))) {
      continue;
    }
    const lower = file.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      errors.push(
        `"${file.name}" isn't a supported type. Use pdf, docx, or xlsx.`,
      );
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`"${file.name}" is larger than 10MB. Try a smaller file.`);
      continue;
    }
    if (count >= MAX_FILES) {
      errors.push(
        "You can add up to 5 files at a time. Remove one to add another.",
      );
      continue;
    }
    accepted.push(file);
    seen.add(fileKey(file));
    count += 1;
  }
  return { accepted, errors };
}
