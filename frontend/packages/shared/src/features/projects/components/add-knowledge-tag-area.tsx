import { FieldLabel } from "@sico/ui";
import { X } from "lucide-react";
import type * as React from "react";

import { TagSelect } from "./tag-select";
import { useKnowledgeTagsQuery } from "../hooks/use-knowledge-tags-query";

export type AddKnowledgeTagAreaProps = {
  projectId: number;
  /** Selected knowledge-tag ids — owned by the consumer. */
  value: number[];
  onChange: (next: number[]) => void;
  /**
   * Field-label class. Defaults to the dialog's 16px label; the asset-detail
   * panel passes its 14px muted class to match its sibling section labels.
   */
  labelClassName?: string;
};

/**
 * "Knowledge tag" tag area — selected tags as removable chips + the shared
 * `<TagSelect>` dropdown. Stateless (consumer owns selection); reads via
 * `useKnowledgeTagsQuery`, which SUSPENDS, so the consumer owns the boundary.
 */
export function AddKnowledgeTagArea({
  projectId,
  value,
  onChange,
  labelClassName = "text-base",
}: AddKnowledgeTagAreaProps): React.JSX.Element {
  const { items } = useKnowledgeTagsQuery(projectId).data;
  const selected = items.filter((tag) => value.includes(tag.id));

  return (
    <div className="flex flex-col gap-3">
      <FieldLabel className={labelClassName}>Knowledge tag</FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        {selected.map((tag) => (
          <span
            key={tag.id}
            className="bg-surface-muted text-foreground-secondary leading-body inline-flex h-6 shrink-0 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium tracking-wider whitespace-nowrap"
          >
            {tag.name}
            <button
              type="button"
              aria-label={`Remove ${tag.name}`}
              onClick={() => onChange(value.filter((v) => v !== tag.id))}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <TagSelect projectId={projectId} value={value} onChange={onChange} />
      </div>
    </div>
  );
}
