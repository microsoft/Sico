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
            className="bg-surface-muted leading-body text-foreground-secondary inline-flex h-6 shrink-0 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium tracking-wider whitespace-nowrap"
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
