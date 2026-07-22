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
