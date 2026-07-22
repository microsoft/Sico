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
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SidepaneContent } from "@/features/chat/atoms/sidepane-atom";
import { FilePreviewer } from "@/features/chat/components/sidepane/previewers/file-previewer";
import { ChatAgentProvider } from "@/features/chat/services/chat-agent-context";
import type { Agent } from "@/features/digital-worker";
import * as deliverableService from "@/features/projects/services/deliverable";
import { ApiClientProvider } from "@/services/api-client-context";

// Real FilePreviewer + real AddToProjectButton — proves the button is keyed by
// fileUri so its mutation state can't leak across an in-place content swap (the
// sidepane swaps the previewed file without remounting the previewer).
vi.mock("@/features/projects/services/deliverable");
vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});
vi.mock("@tanstack/react-router", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const agentWithProject: Agent = {
  id: 601,
  name: "Max",
  project: { id: 84, name: "SICO" },
};

type FileContent = Extract<SidepaneContent, { kind: "file" }>;

// A file deliverable's fileUrl dispatches ImageViewer (a bare <img src>), so
// FileBody never fetches — keeps the test to the add-to-project wiring. The
// `fileUri` (blob-relative) is what the publish addresses by.
function deliverable(fileUri: string): FileContent {
  return {
    kind: "file",
    filename: "shot.png",
    fileUrl: "https://blob.test/test/shot.png",
    fileUri,
    canAddToProject: true,
  };
}

function renderPreviewer(content: FileContent): {
  rerender: (next: FileContent) => void;
} {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  // Seed the agent so projectId resolves on first render (button enabled).
  queryClient.setQueryData(["agents", "detail", 601], agentWithProject);
  const wrap = (c: FileContent): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <ChatAgentProvider agentInstanceId={601} conversationId={1}>
          <Provider store={createStore()}>
            <FilePreviewer content={c} />
          </Provider>
        </ChatAgentProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(wrap(content));
  return { rerender: (next) => rerender(wrap(next)) };
}

beforeEach(() => {
  vi.mocked(deliverableService.addDeliverableToProject).mockReset();
  vi.mocked(deliverableService.addDeliverableToProject).mockResolvedValue();
});

describe("FilePreviewer — add-to-project across an in-place file swap", () => {
  it("re-enables the action when the previewed file is swapped after a successful add", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPreviewer(deliverable("a.png"));
    await user.click(
      await screen.findByRole("button", { name: /add to project/i }),
    );
    // On success the button flips to the "Added to project" folder-check state,
    // inert via aria-disabled (not the `disabled` attribute).
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /added to project/i }),
      ).toHaveAttribute("aria-disabled", "true"),
    );
    // Swap to a different deliverable in the same (unremounted) previewer.
    rerender(deliverable("b.png"));
    const swapped = await screen.findByRole("button", {
      name: /add to project/i,
    });
    expect(swapped).not.toHaveAttribute("aria-disabled");
    expect(swapped).toBeEnabled();
  });

  it("posts the swapped file when added after a swap", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPreviewer(deliverable("a.png"));
    await user.click(
      await screen.findByRole("button", { name: /add to project/i }),
    );
    await waitFor(() =>
      expect(deliverableService.addDeliverableToProject).toHaveBeenCalledTimes(
        1,
      ),
    );
    rerender(deliverable("b.png"));
    await user.click(
      await screen.findByRole("button", { name: /add to project/i }),
    );
    await waitFor(() =>
      expect(deliverableService.addDeliverableToProject).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(deliverableService.addDeliverableToProject).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ fileUri: "b.png" }),
    );
  });
});
