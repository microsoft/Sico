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

import { Globe } from "lucide-react";
import type { JSX } from "react";

import { SandboxedIframe } from "../../../../file-preview/components/sandboxed-iframe";
import type { SidepaneContent } from "../../../atoms/sidepane-atom";
import { SidepaneHeader } from "../sidepane-header";

// Only the webpage variant of the union — the registry hands this previewer
// exactly that shape, so the prop is the narrowed branch, not the whole union.
type WebpageContent = Extract<SidepaneContent, { kind: "webpage" }>;

export type WebpagePreviewerProps = {
  content: WebpageContent;
};

// Verbatim §-copy (no i18n layer in this repo — peer previewers inline their own
// COPY const the same way). `title` doubles as the iframe's accessible name.
const COPY = {
  title: "Preview Page",
  blocked: "This page can't be shown here. Open it in a new tab to view it.",
} as const;

/**
 * Self-contained `kind:"webpage"` previewer (design "A": header + body
 * co-located). Mounts the shared `SidepaneHeader`, then hands the
 * agent-authored URL to `SandboxedIframe` — the shared body that gates the URL
 * to `https:` and frames it under the minimal `sandbox="allow-scripts"`. The
 * D3 file `html` subtype reuses that same body, so the security-critical iframe
 * logic lives in one place instead of being duplicated (as it was in legacy).
 */
export function WebpagePreviewer({
  content,
}: WebpagePreviewerProps): JSX.Element {
  return (
    <div className="bg-surface-basic flex h-full flex-col overflow-hidden">
      <SidepaneHeader icon={Globe} title={COPY.title} />
      <SandboxedIframe
        url={content.url}
        title={COPY.title}
        blockedCopy={COPY.blocked}
      />
    </div>
  );
}
