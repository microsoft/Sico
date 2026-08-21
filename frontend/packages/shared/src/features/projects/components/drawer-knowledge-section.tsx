import { Button } from "@sico/ui";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type * as React from "react";

import { DRAWER_LINK_CTA_CLASS, SECTION_TITLE_CLASS } from "../constants";
import { useKnowledgeTagsQuery } from "../hooks/use-knowledge-tags-query";

const MAX_VISIBLE_KNOWLEDGE_TAGS = 3;

export type DrawerKnowledgeSectionProps = {
  projectId: number;
};

// The "view the tags page" link CTA — used both as the empty-state prompt and
// the "View all" affordance. A real `<Link>` (matches the sidebar's View-all),
// so cmd/middle-click open a new tab. Plain helper (no hooks) so the section
// body stays under the line cap.
function renderTagsLink(projectId: number, label: string): React.JSX.Element {
  return (
    <Button
      variant="link"
      className={DRAWER_LINK_CTA_CLASS}
      nativeButton={false}
      render={
        <Link
          to="/project/$projectId/knowledge-tags"
          params={{ projectId: String(projectId) }}
        />
      }
    >
      {label}
      <ChevronRight />
    </Button>
  );
}

/**
 * Self-fetching Knowledge-tags section for the project drawer. Reads the tags
 * via the (already suspense) query so loading is owned by the wrapping
 * `SilentSection` boundary. Shows up to {@link MAX_VISIBLE_KNOWLEDGE_TAGS}
 * chips, or an "Add your first tag" link when empty; both route to the
 * knowledge-tags page.
 */
export function DrawerKnowledgeSection({
  projectId,
}: DrawerKnowledgeSectionProps): React.JSX.Element {
  const { items: knowledgeTags } = useKnowledgeTagsQuery(projectId).data;
  return (
    <div className="flex flex-col gap-3">
      <p className={SECTION_TITLE_CLASS}>Knowledge tags</p>
      {knowledgeTags.length === 0 ? (
        renderTagsLink(projectId, "Add your first tag.")
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {knowledgeTags
              .slice(0, MAX_VISIBLE_KNOWLEDGE_TAGS)
              .map((knowledgeTag) => (
                <span
                  key={knowledgeTag.id}
                  className="bg-surface-muted leading-body text-foreground-secondary inline-flex h-6 shrink-0 items-center justify-center rounded-sm px-2 py-1 text-xs font-medium tracking-wider whitespace-nowrap"
                >
                  {knowledgeTag.name}
                </span>
              ))}
          </div>
          {knowledgeTags.length > MAX_VISIBLE_KNOWLEDGE_TAGS
            ? renderTagsLink(projectId, "View all")
            : null}
        </div>
      )}
    </div>
  );
}
