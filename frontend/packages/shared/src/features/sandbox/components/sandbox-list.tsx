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

import { type JSX } from "react";

import { iconForSandboxType } from "./sandbox-icon";
import { SandboxStatus } from "./sandbox-status";
import { SandboxThumbnail } from "./sandbox-thumbnail";
import { MessageState } from "../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";
import { type Sandbox } from "../schemas/sandbox";

export type SandboxListProps = {
  sandboxes: Sandbox[];
  onSandboxClick: (sandbox: Sandbox) => void;
};

const COPY = {
  empty: "No devices available.",
} as const;

/**
 * The all-devices grid: one card per live sandbox (type icon + name + status +
 * a non-interactive VNC thumbnail). Clicking a card drills into its instance
 * view. Header chrome (maximize/close) belongs to the shell's SidepaneHeader,
 * so — unlike legacy — this renders only the body.
 *
 * Empty is reachable even though the Device button hides on no sandboxes: the
 * button gates on the agent's RAW device list, while this grid shows only LIVE
 * ones (the query filters by status), so an agent whose devices are all
 * non-live lands here — a shared `MessageState`, not a bare line.
 */
export function SandboxList({
  sandboxes,
  onSandboxClick,
}: SandboxListProps): JSX.Element {
  if (sandboxes.length === 0) {
    // MessageState `fill` centers itself in the scroll container's height, so
    // no hand-rolled centering wrapper (mirrors the grid empty states).
    return (
      <MessageState
        fill
        illustrationUrl={EMPTY_ILLUSTRATIONS.cards.url}
        illustrationWidth={EMPTY_ILLUSTRATIONS.cards.width}
        illustrationHeight={EMPTY_ILLUSTRATIONS.cards.height}
        heading={COPY.empty}
        body=""
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-10 px-16 py-12">
      {sandboxes.map((sandbox) => {
        const Icon = iconForSandboxType(sandbox.type);
        return (
          <button
            key={sandbox.sandboxId}
            type="button"
            onClick={() => onSandboxClick(sandbox)}
            className="bg-surface-sunken shadow-m hover:shadow-l flex cursor-pointer flex-col overflow-hidden rounded-xl text-left transition-shadow"
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <div className="text-foreground-secondary flex min-w-0 items-center gap-1">
                <Icon className="size-4 shrink-0" />
                <span className="truncate text-sm font-medium">
                  {sandbox.displayName}
                </span>
              </div>
              <SandboxStatus status={sandbox.status} />
            </div>
            <div className="px-1 pb-1">
              <div className="bg-surface-basic shadow-s rounded-lg p-2">
                <SandboxThumbnail sandbox={sandbox} />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
