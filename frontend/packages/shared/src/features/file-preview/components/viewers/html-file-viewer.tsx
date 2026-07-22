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

import type { JSX } from "react";

import { SandboxedIframe } from "../sandboxed-iframe";

// Verbatim §-copy (no i18n layer in this repo — peer viewers inline their own
// COPY const the same way). `title` doubles as the iframe's accessible name.
const COPY = {
  title: "File preview",
  blocked: "This file can't be shown here. Download it to view its contents.",
} as const;

export type HtmlFileViewerProps = {
  fileUrl: string;
};

/**
 * HTML file subtype body — an agent-authored `.html` file is untrusted webpage
 * content, so it gets the SAME treatment as the webpage previewer: the shared
 * `SandboxedIframe`, which https-gates the url and frames it under the minimal
 * `sandbox="allow-scripts"`. A non-https url (never expected — file URLs are SAS
 * https URLs) shows the blocked state, which is the correct security posture.
 * The security-critical iframe logic lives in one place, not duplicated here.
 */
export function HtmlFileViewer({ fileUrl }: HtmlFileViewerProps): JSX.Element {
  return (
    <SandboxedIframe
      url={fileUrl}
      title={COPY.title}
      blockedCopy={COPY.blocked}
    />
  );
}
