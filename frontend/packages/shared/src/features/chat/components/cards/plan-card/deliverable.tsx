import { createElement, type JSX, type KeyboardEvent } from "react";

import { useSidepaneActions } from "../../../hooks/use-sidepane";
import { buildSidepaneContent } from "../../../utils/build-sidepane-content";
import {
  deliverableIcon,
  toRenderableDeliverables,
} from "../../../utils/deliverable";

export type DeliverableProps = {
  // Store keeps these as `unknown[]` (proto shape unverified), so the shared
  // narrower validates each entry rather than trust an upstream type.
  deliverables: unknown[];
};

// Per-tool-call deliverable chips inside an expanded PlanStep. Clicking a chip
// builds its SidepaneContent (one mapping — buildSidepaneContent) and opens the
// sidepane.
export function Deliverable({
  deliverables,
}: DeliverableProps): JSX.Element | null {
  const { open } = useSidepaneActions();
  const renderable = toRenderableDeliverables(deliverables);

  if (renderable.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {renderable.map((deliverable) => {
        const activate = (): void => {
          const content = buildSidepaneContent(deliverable);
          if (content) {
            open(content);
          }
        };
        // Enter/Space mirror native button activation (role="button" gives no
        // key handling for free).
        const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        };
        return (
          <div
            key={deliverable.id}
            role="button"
            tabIndex={0}
            onClick={activate}
            onKeyDown={onKeyDown}
            className="bg-surface-muted text-foreground-primary flex h-6 cursor-pointer items-center gap-1 rounded-lg px-2.5"
          >
            {createElement(deliverableIcon(deliverable), {
              className: "size-4 shrink-0",
            })}
            <span
              className="line-clamp-1 text-xs break-all"
              title={deliverable.label}
            >
              {deliverable.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
