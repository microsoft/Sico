import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sico/ui";
import { useMemo } from "react";
import type * as React from "react";

import { DwActionsCell } from "./dw-actions-cell";
import { renderMembersSkeletonCells } from "./members-table-skeleton";
import { DwAvatar } from "../../../components/dw-avatar/dw-avatar";
import { DwStatusIndicator } from "../../digital-worker/components/dw-status-indicator";
import {
  type Agent,
  AgentStatusSchema,
} from "../../digital-worker/schemas/agent";
import { formatLastActive } from "../../projects/utils/format-last-active";
import { sameIdentity } from "../../projects/utils/same-identity";

const WORKER_HEADERS = ["NAME", "OPERATOR", "STATUS", "LAST ACTIVE"] as const;

// How many "loading more" skeleton rows to append while draining later pages.
const LOADING_MORE_ROW_COUNT = 3;

// Shared so the table's loading skeleton mirrors these exact column labels.
export { WORKER_HEADERS };

// The DW status column is binary (per PR313): a live worker (ACTIVE/NEW) reads
// as an "Active" indicator; anything else — inactive, aborted, onboarding, or an
// unset/unknown status — collapses to a muted "Inactive". Uses the same subtle
// dot+label as the Digital Workers list (`DwStatusIndicator`) so the two align.
function isActiveStatus(status: Agent["status"]): boolean {
  return (
    status === AgentStatusSchema.enum.ACTIVE ||
    status === AgentStatusSchema.enum.NEW
  );
}

function statusIndicator(status: Agent["status"]): React.JSX.Element {
  return isActiveStatus(status) ? (
    <DwStatusIndicator tone="success" label="Active" />
  ) : (
    <DwStatusIndicator tone="muted" label="Inactive" />
  );
}

// Active workers first, inactive last; within each group the backend order is
// preserved (stable sort). Kept in the table layer — `selectDedupedAgents` is
// shared with the sidebar/dashboard and must keep the raw paginated order.
function sortByActive(agents: Agent[]): Agent[] {
  return [...agents].sort(
    (a, b) =>
      Number(isActiveStatus(b.status)) - Number(isActiveStatus(a.status)),
  );
}

export type DigitalWorkersTableProps = {
  agents: Agent[];
  /** dw.manage — may reassign / dismiss ANY worker (admin). */
  canManageDw: boolean;
  /** dw.manage.own — may dismiss a worker they invited (member). */
  canInviteDw: boolean;
  /** Current user's email, for the per-row `.own` dismiss check. */
  userEmail: string | null;
  onReassign: (agentId: number) => void;
  /** While draining later pages, append placeholder rows at the tail instead of
   * swapping the whole table for a skeleton — so the rendered rows (and any open
   * Reassign dialog) stay mounted. */
  isFetchingNextPage?: boolean;
};

/** Digital Workers table: one row per real project DW. Admins get reassign +
 * dismiss on every row; a member gets dismiss only on the workers THEY invited
 * (`employerUsername === userEmail`) and never reassign. */
export function DigitalWorkersTable({
  agents,
  canManageDw,
  canInviteDw,
  userEmail,
  onReassign,
  isFetchingNextPage = false,
}: DigitalWorkersTableProps): React.JSX.Element {
  // Memoised so an unrelated parent re-render (e.g. the page-drain skeleton
  // toggling) doesn't re-sort + re-copy the roster; keyed on `agents` identity,
  // which react-query keeps stable until the list actually changes.
  const sorted = useMemo(() => sortByActive(agents), [agents]);
  return (
    <Table>
      <TableHeader>
        <TableRow className="h-13 hover:bg-transparent">
          {WORKER_HEADERS.map((label) => (
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
        {sorted.map((agent) =>
          renderDwRow({
            agent,
            canReassign: canManageDw,
            canDismiss:
              canManageDw ||
              (canInviteDw && sameIdentity(agent.employerUsername, userEmail)),
            // Dismiss doesn't apply to an inactive worker — drop it, leaving
            // Reassign as the only action.
            showDismiss: isActiveStatus(agent.status),
            onReassign: () => onReassign(agent.id),
          }),
        )}
        {isFetchingNextPage
          ? Array.from({ length: LOADING_MORE_ROW_COUNT }, (_, idx) =>
              renderLoadingMoreRow(idx),
            )
          : null}
      </TableBody>
    </Table>
  );
}

// Tail placeholder row shown while draining later pages — reuses the members
// skeleton cells so it reads as part of the same table.
function renderLoadingMoreRow(key: number): React.JSX.Element {
  return (
    <TableRow
      key={`loading-more-${key}`}
      aria-hidden="true"
      className="h-14 hover:bg-transparent"
      data-testid="dw-table-loading-more-row"
    >
      {renderMembersSkeletonCells(WORKER_HEADERS.length)}
    </TableRow>
  );
}

// One DW table row. A render helper (not a component) so the table file holds a
// single component — the only per-row hook logic lives in `DwActionsCell`.
function renderDwRow({
  agent,
  canReassign,
  canDismiss,
  showDismiss,
  onReassign,
}: {
  agent: Agent;
  canReassign: boolean;
  canDismiss: boolean;
  showDismiss: boolean;
  onReassign: () => void;
}): React.JSX.Element {
  // The worker's own last-active time; blank when the backend omits it.
  const lastActive =
    agent.updatedAt === undefined ? "" : formatLastActive(agent.updatedAt);
  return (
    <TableRow key={agent.id} className="h-14">
      <TableCell className="text-foreground-primary px-6">
        <span className="flex min-w-0 items-center gap-2">
          <DwAvatar agent={{ iconUri: agent.iconUri }} decorative size="xs" />
          <span className="truncate">{agent.name}</span>
        </span>
      </TableCell>
      <TableCell className="text-foreground-primary max-w-64 truncate px-6 text-sm">
        {agent.operatorUsername ?? "—"}
      </TableCell>
      <TableCell className="px-6 whitespace-nowrap">
        {statusIndicator(agent.status)}
      </TableCell>
      <TableCell className="text-foreground-secondary px-6 text-sm whitespace-nowrap">
        {lastActive}
      </TableCell>
      <TableCell className="px-6 text-right">
        <DwActionsCell
          agent={agent}
          canReassign={canReassign}
          canDismiss={canDismiss}
          showDismiss={showDismiss}
          onReassign={onReassign}
        />
      </TableCell>
    </TableRow>
  );
}
