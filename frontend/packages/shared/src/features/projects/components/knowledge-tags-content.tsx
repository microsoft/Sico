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

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { Ellipsis } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { ConfirmDialog } from "./confirm-dialog";
import { EditKnowledgeTagDialog } from "./edit-knowledge-tag-dialog";
import { ProjectPageHeader } from "./project-page-header";
import { MessageState } from "../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";
import { useKnowledgeTagMutation } from "../hooks/use-knowledge-tag-mutation";
import { useKnowledgeTagsQuery } from "../hooks/use-knowledge-tags-query";
import { useProjectDetailQuery } from "../hooks/use-project-query";
import type { KnowledgeTag } from "../schemas/knowledge-tag";

const PLAIN_HEADERS = ["KNOWLEDGE TAG", "DESCRIPTION"] as const;

type EditingState = { open: boolean; knowledgeTag?: KnowledgeTag };

// Plain helper (no hooks) to keep one component per file.
function renderKnowledgeTagTable(
  knowledgeTags: KnowledgeTag[],
  onEdit: (knowledgeTag: KnowledgeTag) => void,
  onDelete: (knowledgeTag: KnowledgeTag) => void,
): React.JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow className="h-13">
          {PLAIN_HEADERS.map((label) => (
            <TableHead key={label} className="h-13 px-6 text-sm">
              {label}
            </TableHead>
          ))}
          <TableHead className="h-13 px-6 text-right text-sm">
            ACTIONS
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {knowledgeTags.map((knowledgeTag) => (
          <TableRow key={knowledgeTag.id} className="h-16">
            <TableCell className="leading-body text-foreground-primary w-72 max-w-72 truncate px-6">
              {knowledgeTag.name}
            </TableCell>
            <TableCell className="leading-body text-foreground-primary px-6">
              {knowledgeTag.description}
            </TableCell>
            <TableCell className="px-6 text-right">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="subtle"
                      size="icon-sm"
                      aria-label="Knowledge tag actions"
                    />
                  }
                >
                  <Ellipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(knowledgeTag)}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDelete(knowledgeTag)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function renderEmptyState(): React.JSX.Element {
  return (
    <MessageState
      fill
      illustrationUrl={EMPTY_ILLUSTRATIONS.cards.url}
      illustrationWidth={EMPTY_ILLUSTRATIONS.cards.width}
      illustrationHeight={EMPTY_ILLUSTRATIONS.cards.height}
      heading="No knowledge tags yet"
      body="Create a knowledge tag to organize your assets."
    />
  );
}

type KnowledgeTagsContentProps = {
  projectId: number;
};

/**
 * Suspending body — reads `useKnowledgeTagsQuery`, owns the Add/Edit dialog and
 * delete-confirm seams, and renders the table or empty state.
 */
export function KnowledgeTagsContent({
  projectId,
}: KnowledgeTagsContentProps): React.JSX.Element {
  const { items: knowledgeTags } = useKnowledgeTagsQuery(projectId).data;
  const { data: project } = useProjectDetailQuery(projectId);
  const { remove } = useKnowledgeTagMutation(projectId);
  const navigate = useNavigate();
  const [editing, setEditing] = useState<EditingState>({ open: false });
  const [deleting, setDeleting] = useState<KnowledgeTag | undefined>(undefined);

  const handleDelete = (): void => {
    if (!deleting) {
      return;
    }
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success("Knowledge tag deleted.", { invert: true });
        setDeleting(undefined);
      },
      // Keep the confirm open on failure so the user can retry.
      onError: () => {
        toast.error("We couldn't delete this knowledge tag. Try again.");
      },
    });
  };

  // Knowledge tags is reached only from the workspace drawer's "View all".
  const handleBack = (): void => {
    void navigate({
      to: "/project/$projectId",
      params: { projectId: String(projectId) },
    });
  };

  return (
    <div className="bg-surface-canvas flex h-full min-h-0 flex-col">
      <ProjectPageHeader
        label={project.name}
        current="Knowledge Tags"
        onBack={handleBack}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-6 px-5 pt-11 pb-10 lg:px-16">
        <div className="flex items-center justify-between gap-4">
          <h1
            tabIndex={-1}
            className="text-foreground-primary text-3xl leading-tight font-medium outline-none"
          >
            Knowledge Tags
          </h1>
          <Button
            variant="secondary"
            onClick={() => setEditing({ open: true })}
          >
            Add knowledge tag
          </Button>
        </div>
        {knowledgeTags.length === 0 ? (
          <div className="bg-surface-basic shadow-m min-h-0 flex-1 rounded-2xl">
            {renderEmptyState()}
          </div>
        ) : (
          <div className="bg-surface-basic shadow-m min-h-0 flex-1 overflow-y-auto rounded-2xl">
            {renderKnowledgeTagTable(
              knowledgeTags,
              (knowledgeTag) => setEditing({ open: true, knowledgeTag }),
              setDeleting,
            )}
          </div>
        )}
      </div>
      <EditKnowledgeTagDialog
        open={editing.open}
        onOpenChange={(open) => setEditing((prev) => ({ ...prev, open }))}
        projectId={projectId}
        knowledgeTag={editing.knowledgeTag}
      />
      <ConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          // Lock the confirm while a delete is in flight so Esc / backdrop
          // can't dismiss it mid-request.
          if (!open && !remove.isPending) {
            setDeleting(undefined);
          }
        }}
        title="Delete this knowledge tag?"
        body="Assets tagged with it won't be deleted, but they'll lose this tag."
        onConfirm={handleDelete}
        pending={remove.isPending}
      />
    </div>
  );
}
