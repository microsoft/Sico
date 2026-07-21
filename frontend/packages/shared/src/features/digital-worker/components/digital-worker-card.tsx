import { Link } from "@tanstack/react-router";
import { Briefcase } from "lucide-react";
import { memo, type ReactElement, useState } from "react";

import {
  DwStatusIndicator,
  type DwStatusIndicatorProps,
  STATUS_INDICATOR,
} from "./dw-status-indicator";
import { Card } from "../../../components/card";
import { DwAvatar } from "../../../components/dw-avatar";
import { useSicoConfig } from "../../../services/sico-config-context";
import { logger } from "../../../utils/logger";
import { type Agent, AgentStatusSchema } from "../schemas/agent";

export type DigitalWorkerCardProps = {
  agent: Agent;
};

// Inner content shared by every click-affordance branch of the card: avatar,
// name, optional NEW dot + status indicator, role, and the project row. A plain
// render function (not a component) so this file keeps a single component for
// `react/no-multi-comp`.
function renderCardContent(
  agent: Agent,
  showNewDot: boolean,
  indicator: DwStatusIndicatorProps | undefined,
): ReactElement {
  return (
    <>
      <div className="flex w-full items-center justify-between gap-2">
        <DwAvatar agent={agent} decorative />
        <div className="flex min-w-0 flex-1 flex-col justify-center pl-3">
          <div className="flex w-full items-center gap-1.5">
            <span className="text-foreground-primary truncate text-xl leading-tight font-medium">
              {agent.name}
            </span>
            {showNewDot ? (
              <span
                aria-hidden
                className="bg-primary-600 size-1.5 shrink-0 rounded-full"
              />
            ) : null}
            {indicator ? (
              <span className="ml-auto pl-2">
                <DwStatusIndicator
                  tone={indicator.tone}
                  label={indicator.label}
                />
              </span>
            ) : null}
          </div>
          {agent.role ? (
            <span className="text-foreground-tertiary w-full truncate text-sm leading-tight">
              {agent.role}
            </span>
          ) : null}
        </div>
      </div>
      {agent.project?.name ? (
        <div className="text-foreground-tertiary flex w-full items-center gap-1.5 overflow-hidden">
          <Briefcase
            data-testid="workspace-icon"
            className="size-3.5 shrink-0"
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-sm leading-tight">
            {agent.project.name}
          </span>
        </div>
      ) : null}
    </>
  );
}

// Run the injected click handler with the pending lifecycle: disable the card,
// await the (maybe-async) handler, surface any failure, then re-enable. As an
// `async` function a *synchronous* throw from the handler is also caught (it
// becomes a rejection), so the card can never get stuck disabled.
async function runCardClick(
  handler: (agent: Agent) => void | Promise<void>,
  agent: Agent,
  setIsPending: (pending: boolean) => void,
): Promise<void> {
  setIsPending(true);
  try {
    await handler(agent);
  } catch (error: unknown) {
    logger.error("onDigitalWorkerCardClick failed", {
      agentId: agent.id,
      error,
    });
  } finally {
    setIsPending(false);
  }
}

/**
 * Card for a single Digital Worker. Renders as a link to the DW's
 * collaboration page. The status indicator + NEW dot are gated by
 * `SicoConfig.digitalWorkerCardShowStatus` (off in sico, on in dwp).
 */
function DigitalWorkerCardImpl({
  agent,
}: DigitalWorkerCardProps): ReactElement {
  const { digitalWorkerCardShowStatus, onDigitalWorkerCardClick } =
    useSicoConfig();
  const [isPending, setIsPending] = useState(false);
  // `status` is `AgentStatus | null | undefined`; UNKNOWN is `0` (falsy), so
  // narrow with explicit null/undefined checks rather than a truthy guard.
  const status = agent.status;
  const indicator =
    digitalWorkerCardShowStatus && status !== null && status !== undefined
      ? STATUS_INDICATOR[status]
      : undefined;
  const showNewDot =
    digitalWorkerCardShowStatus && status === AgentStatusSchema.enum.NEW;

  const inner = renderCardContent(agent, showNewDot, indicator);

  // dwp: a config-injected handler owns ALL click branching (status write,
  // routing by lifecycle, opening the onboarding wizard). The card becomes a
  // `<button>` and just awaits the handler — losing the `<a href>` (no
  // middle-click / prefetch) is acceptable since the action is imperative
  // async. `isPending` disables it to block double-clicks.
  if (onDigitalWorkerCardClick) {
    return (
      <Card asChild className="h-32 justify-between text-left">
        <button
          type="button"
          aria-label={`Open ${agent.name}'s collaboration`}
          disabled={isPending}
          className="cursor-pointer disabled:pointer-events-none disabled:opacity-50"
          onClick={() => {
            void runCardClick(onDigitalWorkerCardClick, agent, setIsPending);
          }}
        >
          {inner}
        </button>
      </Card>
    );
  }

  return (
    <Card asChild className="h-32 justify-between">
      <Link
        to="/digital-worker/$agentId"
        params={{ agentId: String(agent.id) }}
        aria-label={`Open ${agent.name}`}
      >
        {inner}
      </Link>
    </Card>
  );
}

export const DigitalWorkerCard = memo(DigitalWorkerCardImpl);
