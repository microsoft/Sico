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
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DigitalWorkerCard } from "@/features/digital-worker/components/digital-worker-card";
import {
  type Agent,
  AgentStatusSchema,
} from "@/features/digital-worker/schemas/agent";
import { SicoConfigProvider } from "@/services/sico-config-context";
import { logger } from "@/utils/logger";

const agent: Agent = {
  id: 5,
  name: "Chloe",
  role: "Marketing",
  project: { name: "SICO" },
  iconUri: "/storage/1/avatar.svg",
};

function renderCard(props: { agent: Agent; showStatus?: boolean }): void {
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <SicoConfigProvider
        config={{ digitalWorkerCardShowStatus: props.showStatus ?? false }}
      >
        <DigitalWorkerCard agent={props.agent} />
      </SicoConfigProvider>
    ),
  });
  const collabRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/digital-worker/$agentId",
    component: () => <div>home</div>,
  });
  const router: AnyRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, collabRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
}

describe("<DigitalWorkerCard>", () => {
  it("renders name, role, project name", async () => {
    renderCard({ agent });
    await screen.findByText("Chloe");
    screen.getByText("Marketing");
    screen.getByText("SICO");
  });

  it("renders avatar as decorative (empty alt; link aria-label names the worker)", async () => {
    renderCard({ agent });
    // Decorative avatar: img present with empty alt — the parent <a>
    // already carries `aria-label="Open Chloe"`, so the avatar is redundant
    // noise for screen readers (WAI-ARIA decorative image pattern).
    await screen.findByRole("link", {
      name: "Open Chloe",
    });
    const img = screen.getByTestId("avatar-fallback-image");
    expect(img).toHaveAttribute("alt", "");
  });

  it("renders as a link to the DW home with aria-label `Open {name}`", async () => {
    renderCard({ agent });
    const link = await screen.findByRole("link", {
      name: "Open Chloe",
    });
    expect(link).toHaveAttribute("href", "/digital-worker/5");
  });

  it("is keyboard reachable (focusable)", async () => {
    renderCard({ agent });
    const link = await screen.findByRole("link");
    link.focus();
    expect(link).toHaveFocus();
  });

  it("renders briefcase workspace icon when project is present", async () => {
    renderCard({ agent });
    await screen.findByTestId("workspace-icon");
  });

  it("hides workspace icon when project is missing", async () => {
    renderCard({ agent: { ...agent, project: undefined } });
    await screen.findByText("Chloe");
    expect(screen.queryByTestId("workspace-icon")).not.toBeInTheDocument();
  });

  // Status indicator (dot + same-colour label, no fill — mirrors dwp's
  // `StatusTag appearance="subtle"`). Gated by SicoConfig.digitalWorkerCardShowStatus.
  describe("status indicator (gated by showStatus)", () => {
    it("hides the indicator when showStatus is off (sico default)", async () => {
      renderCard({
        agent: { ...agent, status: AgentStatusSchema.enum.ACTIVE },
      });
      await screen.findByText("Chloe");
      expect(screen.queryByText("Active")).not.toBeInTheDocument();
    });

    it("renders the status indicator when showStatus is on (dwp)", async () => {
      renderCard({
        agent: { ...agent, status: AgentStatusSchema.enum.ACTIVE },
        showStatus: true,
      });
      const label = await screen.findByText("Active");
      // The indicator must live in the name's flex row so it centers against
      // the name (not the taller avatar row). Guards the alignment fix.
      const nameRow = screen.getByText("Chloe").parentElement;
      expect(nameRow).not.toBeNull();
      expect(nameRow).toContainElement(label);
    });

    it("renders no indicator for an absent status even when showStatus is on", async () => {
      renderCard({ agent: { ...agent, status: undefined }, showStatus: true });
      await screen.findByText("Chloe");
      expect(screen.queryByText("Active")).not.toBeInTheDocument();
      expect(screen.queryByText("Onboarding")).not.toBeInTheDocument();
    });
  });

  describe("onDigitalWorkerCardClick (dwp injected handler)", () => {
    function renderWithHandler(
      onClick: (a: Agent) => void | Promise<void>,
    ): void {
      const rootRoute = createRootRoute({ component: () => <Outlet /> });
      const indexRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/",
        component: () => (
          <SicoConfigProvider config={{ onDigitalWorkerCardClick: onClick }}>
            <DigitalWorkerCard agent={agent} />
          </SicoConfigProvider>
        ),
      });
      const router: AnyRouter = createRouter({
        routeTree: rootRoute.addChildren([indexRoute]),
        history: createMemoryHistory({ initialEntries: ["/"] }),
      });
      render(<RouterProvider router={router} />);
    }

    it("renders a button (not a link) and fires the handler with the agent", async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      renderWithHandler(onClick);
      // The whole card is a button — no <a> link.
      const button = await screen.findByRole("button", {
        name: "Open Chloe's collaboration",
      });
      expect(
        screen.queryByRole("link", { name: /Chloe/ }),
      ).not.toBeInTheDocument();
      await user.click(button);
      expect(onClick).toHaveBeenCalledWith(agent);
    });

    it("keeps content left-aligned (a <button> defaults to centered text)", async () => {
      renderWithHandler(vi.fn());
      const button = await screen.findByRole("button", {
        name: "Open Chloe's collaboration",
      });
      // Regression guard: the shared Card surface is generic, so the button
      // branch must re-assert `text-left` — without it the button's UA-default
      // `text-align: center` drifts the name/role toward the middle. (The link
      // branch needs nothing: an <a> already defaults to left.)
      expect(button).toHaveClass("text-left");
    });

    it("disables the button while an async handler is pending", async () => {
      const user = userEvent.setup();
      let resolveHandler: (() => void) | undefined;
      const onClick = vi.fn(
        (): Promise<void> =>
          new Promise<void>((resolve) => {
            resolveHandler = resolve;
          }),
      );
      renderWithHandler(onClick);
      const button = await screen.findByRole("button", {
        name: "Open Chloe's collaboration",
      });
      await user.click(button);
      // The handler's promise is still pending → the card guards re-entry
      // and shows the disabled visual treatment.
      expect(button).toBeDisabled();
      expect(button).toHaveClass(
        "disabled:pointer-events-none",
        "disabled:opacity-50",
      );
      resolveHandler?.();
    });

    it("re-enables the button after the handler rejects (no permanent disable)", async () => {
      const user = userEvent.setup();
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const onClick = vi.fn(() => Promise.reject(new Error("write failed")));
      renderWithHandler(onClick);
      const button = await screen.findByRole("button", {
        name: "Open Chloe's collaboration",
      });
      await user.click(button);
      // `.finally` resets pending on the rejection path, and `.catch` surfaces
      // it via the logger instead of leaving an unhandled rejection.
      await vi.waitFor(() => expect(button).not.toBeDisabled());
      expect(errorSpy).toHaveBeenCalledWith(
        "onDigitalWorkerCardClick failed",
        expect.objectContaining({ agentId: agent.id }),
      );
      errorSpy.mockRestore();
    });

    it("re-enables the button after a handler that throws synchronously", async () => {
      const user = userEvent.setup();
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const onClick = vi.fn(() => {
        throw new Error("sync boom");
      });
      renderWithHandler(onClick);
      const button = await screen.findByRole("button", {
        name: "Open Chloe's collaboration",
      });
      await user.click(button);
      // A synchronous throw must still be caught — otherwise the button would
      // stay permanently disabled.
      await vi.waitFor(() => expect(button).not.toBeDisabled());
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
