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
