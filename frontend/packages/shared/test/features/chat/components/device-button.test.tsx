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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { sidepaneContentAtom } from "@/features/chat/atoms/sidepane-atom";
import { DeviceButton } from "@/features/chat/components/device-button";
import type { Agent } from "@/features/digital-worker";
import { ApiClientProvider } from "@/services/api-client-context";

const AGENT_ID = 413;

function agent(overrides: Partial<Agent> = {}): Agent {
  return { id: AGENT_ID, name: "Max", sandboxes: [{}], ...overrides };
}

// Seed the agent-detail cache so the button's `useQuery` resolves synchronously
// (the real Header populates it the same way); the button reads `sandboxes` off
// it to decide whether to render.
function renderButton(seeded: Agent | undefined): {
  store: ReturnType<typeof createStore>;
} {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (seeded) {
    queryClient.setQueryData(["agents", "detail", AGENT_ID], seeded);
  }
  const ui: ReactElement = <DeviceButton agentInstanceId={AGENT_ID} />;
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={{} as AxiosInstance}>
        <JotaiProvider store={store}>{ui}</JotaiProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return { store };
}

describe("DeviceButton", () => {
  it("renders a labelled Device button when the agent has sandboxes", () => {
    renderButton(agent());
    expect(screen.getByRole("button", { name: /device/i })).toBeInTheDocument();
  });

  it("renders nothing when the agent has no sandboxes", () => {
    renderButton(agent({ sandboxes: [] }));
    expect(screen.queryByRole("button", { name: /device/i })).toBeNull();
  });

  it("opens the sandbox sidepane carrying the agent instance id on click", async () => {
    const user = userEvent.setup();
    const { store } = renderButton(agent());
    expect(store.get(sidepaneContentAtom)).toBeNull();
    await user.click(screen.getByRole("button", { name: /device/i }));
    expect(store.get(sidepaneContentAtom)).toEqual({
      kind: "sandbox",
      agentInstanceId: AGENT_ID,
    });
  });
});
