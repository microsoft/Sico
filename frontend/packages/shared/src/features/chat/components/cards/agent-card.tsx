import { type JSX } from "react";

import { Markdown } from "../../../../components/markdown";
import { useSmoothText } from "../../hooks/use-smooth-text";

export type AgentCardProps = {
  text: string;
  // Still receiving frames; forwarded to <Markdown> so it re-parses only the
  // live tail, not the whole body each frame.
  streaming?: boolean;
};

// Unframed, left-aligned Markdown body — no bubble, unlike UserCard. Block flow
// (not flex-col) so child blocks' own my-2/first:mt-0 spacing applies. While
// streaming, the text is revealed with a typewriter smoothing pass so the
// network-chunked frames type in steadily instead of jumping in bursts.
export function AgentCard({ text, streaming }: AgentCardProps): JSX.Element {
  const smoothed = useSmoothText(text, streaming ?? false);
  return (
    // `min-w-0 wrap-anywhere`: a long unbreakable token (e.g. a `file:///…`
    // artifact path with no spaces) must not push this flex column past its
    // `max-w` — `wrap-anywhere` lets it break mid-token so the message stays
    // within the column instead of overflowing to the right.
    <div className="text-foreground-primary min-w-0 text-base wrap-anywhere">
      <Markdown content={smoothed} streaming={streaming} />
    </div>
  );
}
