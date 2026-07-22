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

import { toast } from "@sico/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import type { ReactElement, MouseEvent as ReactMouseEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddToProjectButton } from "@/features/chat/components/sidepane/add-to-project-button";
import { ChatAgentProvider } from "@/features/chat/services/chat-agent-context";
import type { Agent } from "@/features/digital-worker";
import * as agentService from "@/features/digital-worker/services/agents";
import * as deliverableService from "@/features/projects/services/deliverable";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/digital-worker/services/agents");
vi.mock("@/features/projects/services/deliverable");
vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("@tanstack/react-router", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

const agentWithProject: Agent = {
  id: 601,
  name: "Max",
  project: { id: 84, name: "SICO" },
};

// The toast `action` is a wide union; this narrows it to the clickable button
// shape the component passes, so the test can invoke onClick without an `as`.
type ClickableAction = {
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

function isClickableAction(value: unknown): value is ClickableAction {
  return (
    typeof value === "object" &&
    value !== null &&
    "onClick" in value &&
    typeof (value as { onClick: unknown }).onClick === "function"
  );
}

function renderButton(fileUri = "default_space/0/hello.md"): {
  queryClient: QueryClient;
} {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  // Seed the agent detail so `projectId` is resolved on first render — then the
  // only reason the button can be disabled is an empty fileUri, not loading.
  queryClient.setQueryData(["agents", "detail", 601], agentWithProject);
  const ui: ReactElement = (
    <AddToProjectButton fileUri={fileUri} filename="hello.md" />
  );
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <ChatAgentProvider agentInstanceId={601} conversationId={1}>
          {ui}
        </ChatAgentProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return { queryClient };
}

beforeEach(() => {
  vi.mocked(agentService.fetchAgentDetail).mockReset();
  vi.mocked(agentService.fetchAgentDetail).mockResolvedValue(agentWithProject);
  vi.mocked(deliverableService.addDeliverableToProject).mockReset();
  vi.mocked(deliverableService.addDeliverableToProject).mockResolvedValue();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  navigateMock.mockReset();
});

describe("AddToProjectButton", () => {
  it("posts the deliverable with the agent's projectId + fileUri on click", async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(
      await screen.findByRole("button", { name: /add to project/i }),
    );
    await waitFor(() =>
      expect(deliverableService.addDeliverableToProject).toHaveBeenCalledWith(
        expect.anything(),
        {
          projectId: 84,
          agentInstanceId: 601,
          fileUri: "default_space/0/hello.md",
          fileName: "hello.md",
        },
      ),
    );
  });

  it("shows a success toast after the file is shared", async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(
      await screen.findByRole("button", { name: /add to project/i }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("disables the button when the fileUri is empty (can't add)", async () => {
    renderButton("");
    // projectId is seeded, so the only reason to stay disabled is empty fileUri.
    expect(
      await screen.findByRole("button", { name: /add to project/i }),
    ).toBeDisabled();
  });

  it("does not post when the fileUri is empty", async () => {
    const user = userEvent.setup();
    renderButton("");
    await user.click(screen.getByRole("button", { name: /add to project/i }));
    expect(deliverableService.addDeliverableToProject).not.toHaveBeenCalled();
  });

  it("marks the button as added (aria-disabled, not visually disabled) after a successful add", async () => {
    const user = userEvent.setup();
    renderButton();
    const button = await screen.findByRole("button", {
      name: /add to project/i,
    });
    await user.click(button);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /added to project/i }),
      ).toHaveAttribute("aria-disabled", "true"),
    );
    const settled = screen.getByRole("button", { name: /added to project/i });
    expect(settled).not.toBeDisabled();
  });

  it("does not re-post on a second click after a successful add", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderButton();
    const button = await screen.findByRole("button", {
      name: /add to project/i,
    });
    await user.click(button);
    await waitFor(() =>
      expect(deliverableService.addDeliverableToProject).toHaveBeenCalledTimes(
        1,
      ),
    );
    await user.click(screen.getByRole("button", { name: /added to project/i }));
    expect(deliverableService.addDeliverableToProject).toHaveBeenCalledTimes(1);
  });

  it("navigates to the project's deliverables when the success toast View action fires", async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(
      await screen.findByRole("button", { name: /add to project/i }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    // The toast is mocked; pull the action off the call and invoke its onClick
    // (the View link is the whole reason project.id is threaded through). The
    // toast `action` is a wide union (button-shape | ReactNode | primitive);
    // narrow to the { onClick } button shape the source passes before invoking.
    const [, options] = vi.mocked(toast.success).mock.calls[0] ?? [];
    const action = options?.action;
    if (!isClickableAction(action)) {
      throw new Error("expected a toast action with an onClick");
    }
    action.onClick({} as ReactMouseEvent<HTMLButtonElement>);
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/project/$projectId/deliverable",
      params: { projectId: "84" },
    });
  });

  it("shows an error toast when the add fails", async () => {
    vi.mocked(deliverableService.addDeliverableToProject).mockRejectedValueOnce(
      new Error("boom"),
    );
    const user = userEvent.setup();
    renderButton();
    await user.click(
      await screen.findByRole("button", { name: /add to project/i }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
