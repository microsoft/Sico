import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@sico/ui";
import { ArrowDownToLine, FileText } from "lucide-react";
import { type JSX, useCallback } from "react";

import { Markdown } from "../../../../../components/markdown";
import { MessageState } from "../../../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../../../constants/empty-illustration";
import { saveBlob } from "../../../../../utils/save-blob";
import type { SidepaneContent } from "../../../atoms/sidepane-atom";
import { SidepaneHeader } from "../sidepane-header";

// Only the markdown variant of the union — the registry hands this previewer
// exactly that shape, so the prop is the narrowed branch, not the whole union.
type MarkdownContent = Extract<SidepaneContent, { kind: "markdown" }>;

export type MarkdownPreviewerProps = {
  content: MarkdownContent;
};

// Verbatim §-copy (no i18n layer in this repo — peer empty states inline their
// own COPY const the same way).
const COPY = {
  download: "Download",
  empty: "There's nothing to preview here yet.",
} as const;

/**
 * Self-contained `kind:"markdown"` previewer (design "A": header + body
 * co-located). Mounts the shared `SidepaneHeader` with a Download action and
 * renders the body through the shared `Markdown` boundary (#189) — never a
 * re-implementation. Blank markdown swaps to the shared empty state (MI17).
 * The shell wraps this in an ErrorBoundary, so render faults are out of scope.
 */
export function MarkdownPreviewer({
  content,
}: MarkdownPreviewerProps): JSX.Element {
  const { title, markdown } = content;
  // Treat whitespace-only as empty: an agent emitting "\n\n" or "   " would
  // otherwise render a near-blank Markdown instead of the empty state (MI17).
  const isEmpty = markdown.trim() === "";

  const handleDownload = useCallback(() => {
    // The markdown is already in memory, so the file is built client-side (no
    // network round-trip) and handed to the shared `saveBlob` helper.
    const blob = new Blob([markdown], { type: "text/markdown" });
    // A markdown deliverable may carry a blank label (the narrower defaults an
    // absent title to ""), which would download a nameless ".md" dotfile — fall
    // back to a sensible base name.
    saveBlob(blob, `${title.trim() || "Untitled"}.md`);
  }, [markdown, title]);

  return (
    <div className="bg-surface-basic @container flex h-full flex-col overflow-y-auto">
      <SidepaneHeader
        icon={FileText}
        title={title}
        actionsSlot={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="subtle"
                  size="icon-xs"
                  aria-label={COPY.download}
                  onClick={handleDownload}
                >
                  <ArrowDownToLine className="size-4" />
                </Button>
              }
            />
            <TooltipContent>{COPY.download}</TooltipContent>
          </Tooltip>
        }
      />
      {isEmpty ? (
        <MessageState
          fill
          illustrationUrl={EMPTY_ILLUSTRATIONS.cards.url}
          illustrationWidth={EMPTY_ILLUSTRATIONS.cards.width}
          illustrationHeight={EMPTY_ILLUSTRATIONS.cards.height}
          heading={COPY.empty}
          body=""
        />
      ) : (
        // Fluid reading gutter: a narrow side-pane (container < 768px) gets a
        // minimal px-4 so the body isn't crushed; at ≥768px it returns to the
        // px-34 document gutter shared with the asset-detail markdown bodies.
        // Container-query (not viewport) so it tracks the pane's own width.
        // Internal prose typography is owned by `Markdown`.
        <div
          data-testid="markdown-previewer-body"
          className="flex flex-col px-4 py-11 @3xl:px-34"
        >
          <Markdown content={markdown} />
        </div>
      )}
    </div>
  );
}
