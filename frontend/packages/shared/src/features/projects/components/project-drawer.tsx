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
  AvatarGroup,
  AvatarGroupCount,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@sico/ui";
import { Ellipsis, Pencil } from "lucide-react";
import type * as React from "react";

import { DwAvatar } from "../../../components/dw-avatar/dw-avatar";
import { ProjectAvatar } from "../../../components/project-avatar";
import { UserAvatar } from "../../../components/user-avatar/user-avatar";
import { MAX_VISIBLE_AGENTS } from "../constants";
import { CollapsiblePanelShell } from "./collapsible-panel-shell";
import type { KnowledgeTag } from "../schemas/knowledge-tag";
import { MemberTypeSchema, type ProjectDetail } from "../schemas/project";

const MAX_VISIBLE_KNOWLEDGE_TAGS = 3;

const TITLE_CLASS = "text-foreground-primary leading-body-2 font-medium";
const SUBTLE_CLASS = "text-foreground-secondary leading-body text-sm";

// Prop-independent JSX hoisted to module scope so the render body stays under
// the line ceiling (mirrors `TABS_LIST` in assets-table.tsx).
const DIVIDER = <hr className="border-divider w-full border-t border-solid" />;

/** OWNER and ADMIN may mutate; a plain MEMBER sees a read-only drawer. */
function canEditProject(memberType: ProjectDetail["memberType"]): boolean {
  return (
    memberType === MemberTypeSchema.enum.OWNER ||
    memberType === MemberTypeSchema.enum.ADMIN
  );
}

// Render helpers — plain module-scope functions (NOT nested components, so
// `react/no-unstable-nested-components` never fires) that keep `ProjectDrawer`
// a single component under the 100-line cap.

function renderMeta(
  project: ProjectDetail,
  canEdit: boolean,
  onEditProject: () => void,
): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <ProjectAvatar project={project} size="lg" decorative />
        {canEdit ? (
          <Button
            variant="subtle"
            size="icon-sm"
            aria-label="Edit project"
            onClick={onEditProject}
          >
            <Pencil />
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <p className={TITLE_CLASS}>{project.name}</p>
        <p className="leading-body-2 text-foreground-primary">
          {project.description}
        </p>
        <p className={SUBTLE_CLASS}>Created by {project.creatorUsername}</p>
      </div>
    </div>
  );
}

function renderWorkers(
  agents: ProjectDetail["agentInstances"],
): React.JSX.Element {
  // Mirror the project card: cap visible avatars and collapse the rest
  // into a `+N` count so a large roster doesn't overflow the drawer.
  const visible = agents.slice(0, MAX_VISIBLE_AGENTS);
  const overflow = agents.length - visible.length;
  return (
    <div className="flex flex-col gap-2">
      <p className={SUBTLE_CLASS}>Digital workers</p>
      <div className="flex items-center gap-2">
        {agents.length > 0 ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <AvatarGroup>
              {visible.map((agent) => (
                <DwAvatar
                  key={agent.id}
                  agent={{ iconUri: agent.iconUrl }}
                  decorative
                  size="sm"
                />
              ))}
            </AvatarGroup>
            {overflow > 0 ? (
              <AvatarGroupCount aria-label={`${overflow} more agents`}>
                +{overflow}
              </AvatarGroupCount>
            ) : null}
          </div>
        ) : null}
        <p className={SUBTLE_CLASS}>{agents.length} members</p>
      </div>
    </div>
  );
}

function renderOperators(
  operators: string[],
  canEdit: boolean,
  onRemoveOperator?: (username: string) => void,
): React.JSX.Element | null {
  // No operators → render nothing (the caller drops the leading divider too), so
  // the panel never shows a lone "Operators" heading between two rules.
  if (operators.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className={TITLE_CLASS}>Operators</p>
      <div className="flex flex-col gap-2">
        {operators.map((username) => (
          // OQ-B: operator identifier (username vs email) unresolved
          <div
            key={username}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <UserAvatar user={{ name: username }} decorative size="sm" />
              <span className="text-foreground-primary truncate">
                {username}
              </span>
            </div>
            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="subtle"
                      size="icon-sm"
                      aria-label={`Actions for ${username}`}
                    />
                  }
                >
                  <Ellipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => onRemoveOperator?.(username)}
                  >
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderKnowledgeTags(
  knowledgeTags: KnowledgeTag[],
  onViewAllKnowledgeTags: () => void,
): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <p className={TITLE_CLASS}>Knowledge tags</p>
      {knowledgeTags.length === 0 ? (
        <Button
          variant="link"
          className="text-foreground-tertiary hover:text-foreground-secondary active:text-foreground-secondary h-auto self-start p-0 underline"
          onClick={onViewAllKnowledgeTags}
        >
          Add your first tag.
        </Button>
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
          {knowledgeTags.length > MAX_VISIBLE_KNOWLEDGE_TAGS ? (
            <Button
              variant="link"
              className="text-foreground-tertiary hover:text-foreground-secondary active:text-foreground-secondary h-auto self-start p-0 underline"
              onClick={onViewAllKnowledgeTags}
            >
              View all
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export type ProjectDrawerProps = {
  project: ProjectDetail;
  knowledgeTags: KnowledgeTag[];
  onEditProject: () => void;
  onViewAllKnowledgeTags: () => void;
  onRemoveOperator?: (username: string) => void;
  onToggleCollapse: () => void;
};

/**
 * Presentational right-column panel for the per-project workspace. It only
 * DISPLAYS data its parent already fetched (the `projectDetail` + `knowledgeTags`
 * queries) and RAISES callbacks — it owns no fetch, no dialogs, and no collapse
 * state (the parent workspace owns that, raising `onToggleCollapse` for the
 * header collapse button). Mutating affordances (edit ✏️, operator Remove) render
 * only when the viewer is an OWNER or ADMIN; a plain MEMBER sees the same sections
 * read-only.
 */
export function ProjectDrawer({
  project,
  knowledgeTags,
  onEditProject,
  onViewAllKnowledgeTags,
  onRemoveOperator,
  onToggleCollapse,
}: ProjectDrawerProps): React.JSX.Element {
  const canEdit = canEditProject(project.memberType);
  return (
    <CollapsiblePanelShell
      title="Project details"
      onCollapse={onToggleCollapse}
      bodyGap="gap-6"
    >
      {renderMeta(project, canEdit, onEditProject)}
      {renderWorkers(project.agentInstances)}
      {project.operatorAdmins.length > 0 ? DIVIDER : null}
      {renderOperators(project.operatorAdmins, canEdit, onRemoveOperator)}
      {DIVIDER}
      {renderKnowledgeTags(knowledgeTags, onViewAllKnowledgeTags)}
    </CollapsiblePanelShell>
  );
}
