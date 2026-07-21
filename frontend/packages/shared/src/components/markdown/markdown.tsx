import { type JSX } from "react";

import { MarkdownBlock } from "./markdown-block";
import { splitStablePrefix } from "../../utils/split-stable-prefix";

export type MarkdownProps = {
  content: string;
  // Opt-in incremental render for a growing turn (§6.E7c): split into a settled
  // prefix + live tail so only the tail re-parses each frame.
  streaming?: boolean;
};

// XSS-safe Markdown boundary: react-markdown + remark-gfm with **no rehype-raw**,
// so raw HTML surfaces as escaped text, not live nodes (§6.E6).
//
// Both modes render the SAME two-block Fragment (non-streaming = whole body in
// the prefix, empty tail), so toggling `streaming` on a live instance never
// swaps the element type here — which would remount the subtree (re-highlight,
// dropped `<details open>`, scroll jump).
export function Markdown({ content, streaming }: MarkdownProps): JSX.Element {
  const at = streaming ? splitStablePrefix(content) : content.length;
  return (
    <>
      <MarkdownBlock content={content.slice(0, at)} />
      <MarkdownBlock content={content.slice(at)} />
    </>
  );
}
