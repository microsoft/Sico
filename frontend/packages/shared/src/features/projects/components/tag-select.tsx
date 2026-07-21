import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from "@sico/ui";
import { Loader2, Plus } from "lucide-react";
import type * as React from "react";
import { useRef, useState } from "react";

import { useKnowledgeTagMutation } from "../hooks/use-knowledge-tag-mutation";
import { useKnowledgeTagsQuery } from "../hooks/use-knowledge-tags-query";

export type TagSelectProps = {
  projectId: number;
  /** Selected knowledge-tag ids — owned by the consumer. */
  value: number[];
  onChange: (next: number[]) => void;
};

/**
 * Shared select-or-create tag dropdown (design.md §6 dec 11) — the single
 * control for every "attach a knowledge tag" point (Add Knowledge,
 * asset-detail inline edit, edit-asset). Built on `@sico/ui` DropdownMenu:
 * checkable existing tags that stay open on toggle (Base UI default) plus a
 * top "+ Create new tag" row that swaps to an inline input.
 *
 * Reads its list via `useKnowledgeTagsQuery`, which SUSPENDS — the consumer owns
 * the `<Suspense>` + error boundary.
 */
export function TagSelect({
  projectId,
  value,
  onChange,
}: TagSelectProps): React.JSX.Element {
  const { items } = useKnowledgeTagsQuery(projectId).data;
  const { create } = useKnowledgeTagMutation(projectId);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  // create.onSuccess fires after an async boundary — read the live selection
  // from a ref, never a stale closure (.claude/rules/react.md).
  const valueRef = useRef(value);
  valueRef.current = value;

  function submit(): void {
    const trimmed = name.trim();
    if (!trimmed || create.isPending) {
      return;
    }
    create.mutate(
      { projectId, name: trimmed, description: "" },
      {
        onSuccess: (newId) => {
          onChange([...valueRef.current, newId]);
          setName("");
          setCreating(false);
        },
        // Keep the typed name + open input on failure so the user can retry,
        // rather than the spinner vanishing with no signal (silent failure).
        onError: () => {
          toast.error("We couldn't create the tag. Try again.");
        },
      },
    );
  }

  return (
    <DropdownMenu onOpenChange={(open) => !open && setCreating(false)}>
      <DropdownMenuTrigger render={<Button variant="subtle" size="sm" />}>
        <Plus />
        Add tag
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-70 w-72" align="start">
        {creating ? (
          <div className="flex h-10 items-center gap-2 rounded-lg px-3">
            <input
              autoFocus
              type="text"
              aria-label="Tag name"
              placeholder="Input label name"
              value={name}
              disabled={create.isPending}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                } else if (e.key !== "Escape") {
                  // Keep the menu's typeahead from stealing keystrokes.
                  e.stopPropagation();
                }
              }}
              className="text-foreground-primary placeholder:text-foreground-faint flex-1 bg-transparent text-sm outline-none disabled:opacity-50"
            />
            {create.isPending ? (
              <Loader2 className="text-icon-secondary size-4 animate-spin" />
            ) : null}
          </div>
        ) : (
          <DropdownMenuItem
            closeOnClick={false}
            onClick={() => setCreating(true)}
            className="text-foreground-link-rest focus:text-foreground-link-hover"
          >
            <Plus />
            Create new tag
          </DropdownMenuItem>
        )}
        {items.length === 0 ? (
          <div className="text-foreground-tertiary flex h-10 items-center px-3 text-sm select-none">
            No tags yet.
          </div>
        ) : (
          items.map((tag) => (
            <DropdownMenuCheckboxItem
              key={tag.id}
              checked={value.includes(tag.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...value, tag.id]
                    : value.filter((v) => v !== tag.id),
                )
              }
            >
              {tag.name}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
