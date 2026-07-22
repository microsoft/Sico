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

import { Spinner } from "@sico/ui";
import { type JSX, useMemo, useState } from "react";

import { SandboxApps } from "./sandbox/sandbox-apps";
import { SandboxHeaderShell } from "./sandbox/sandbox-header-shell";
import { SandboxInstance } from "./sandbox/sandbox-instance";
import { ErrorView } from "../../../../../components/error-view";
import { SandboxList } from "../../../../sandbox/components/sandbox-list";
import { useSandboxInstancesQuery } from "../../../../sandbox/hooks/use-sandbox-instances-query";
import { type Sandbox } from "../../../../sandbox/schemas/sandbox";
import type { SidepaneContent } from "../../../atoms/sidepane-atom";

// Only the sandbox variant of the union — the registry hands this previewer
// exactly that shape (it carries the agent instance id the poll keys off).
type SandboxContent = Extract<SidepaneContent, { kind: "sandbox" }>;

export type SandboxPreviewerProps = {
  content: SandboxContent;
};

// What the user last asked for. `none` = no explicit choice yet, so the view
// auto-resolves (lone device drills in, otherwise the grid). `grid` = they hit
// "View all" and want the list even for a single device. `{ id }` = they picked
// a specific device. `manageApps` = they opened the app manager from a device.
// Derived into the actual view at render — never written from an effect, so a
// 5 s poll re-resolves the view without a setState cascade.
type Intent =
  | { kind: "none" }
  | { kind: "grid" }
  | { kind: "device"; id: string }
  | { kind: "manageApps" };

/**
 * The sandbox previewer body (D2): a 2-view machine over the agent's live
 * device list. Multiple devices show the grid (`SandboxList`); picking one — or
 * a lone device — drills into the interactive `SandboxInstance`. The list polls
 * every 5 s; the user's `Intent` is reconciled against each fresh list at
 * render (not in an effect), so a background refresh never yanks them off their
 * chosen device, and a vanished device falls back to the grid (legacy index.tsx).
 */
export function SandboxPreviewer({
  content,
}: SandboxPreviewerProps): JSX.Element {
  const query = useSandboxInstancesQuery(content.agentInstanceId);
  const devices = useMemo(() => query.data ?? [], [query.data]);

  const [intent, setIntent] = useState<Intent>({ kind: "none" });

  // Resolve the user's intent against the live list at render — no effect, no
  // setState. An explicit device pick wins while that device is present; an
  // explicit "View all" holds the grid; with no choice, a lone device drills in
  // and anything else shows the grid.
  const selected = useMemo<Sandbox | undefined>(() => {
    if (intent.kind === "device") {
      return devices.find((d) => d.sandboxId === intent.id);
    }
    if (intent.kind === "grid") {
      return undefined;
    }
    return devices.length === 1 ? devices[0] : undefined;
  }, [intent, devices]);

  // First load (no cached data yet) shows a spinner; a fetch failure shows the
  // shared ErrorView with retry. Both center their content in the same flex box
  // under the previewer header. A spinner (not a skeleton) is deliberate: the
  // device count surfaced here is the post-filter live set, unknown until the
  // fetch resolves, so we can't pre-shape a grid-vs-instance skeleton.
  if (query.isPending) {
    return (
      <SandboxHeaderShell>
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="lg" aria-label="Loading devices" />
        </div>
      </SandboxHeaderShell>
    );
  }
  if (query.isError) {
    return (
      <SandboxHeaderShell>
        {/* ErrorView self-centers (MessageState `fill`), so it mounts directly
            in the shell's flex column — no extra centering wrapper. */}
        <ErrorView
          error={query.error}
          resetErrorBoundary={() => {
            // Fire-and-forget the refetch; the boundary re-renders off the
            // query state, so the returned promise is intentionally ignored.
            void query.refetch();
          }}
        />
      </SandboxHeaderShell>
    );
  }

  // Manage-apps view: opened from a device, spans the whole device set. Back
  // returns to the device that opened it (or the grid if it vanished). Requires
  // at least one device; an empty set falls through to the grid's empty state.
  if (intent.kind === "manageApps" && devices.length > 0) {
    return (
      <SandboxApps
        agentInstanceId={content.agentInstanceId}
        devices={devices}
        onBack={() => setIntent({ kind: "none" })}
      />
    );
  }

  if (selected) {
    return (
      <SandboxInstance
        sandboxes={devices}
        selected={selected}
        onSelect={(s) => setIntent({ kind: "device", id: s.sandboxId })}
        onViewAll={() => setIntent({ kind: "grid" })}
        onManageApps={() => setIntent({ kind: "manageApps" })}
      />
    );
  }

  return (
    <SandboxHeaderShell>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SandboxList
          sandboxes={devices}
          onSandboxClick={(s) => setIntent({ kind: "device", id: s.sandboxId })}
        />
      </div>
    </SandboxHeaderShell>
  );
}
