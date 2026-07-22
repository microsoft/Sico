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
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LoginLayout } from "@/components/shell/login-layout";

import { restoreOnline, setOnline } from "../../helpers/network";

// `<LoginLayout>` runs `useFocusFirstHeading` which calls `useRouterState`
// and therefore needs a Router context.
function makeRouter(): { router: AnyRouter } {
  const rootRoute = createRootRoute({
    component: function Root() {
      return (
        <LoginLayout>
          <Outlet />
        </LoginLayout>
      );
    },
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return { router };
}

describe("<LoginLayout>", () => {
  afterEach(() => {
    restoreOnline();
  });

  it("renders <main> landmark", async () => {
    const { router } = makeRouter();
    render(<RouterProvider router={router} />);
    await screen.findByRole("main");
  });

  it("does not render its own <h1>", async () => {
    const { router } = makeRouter();
    render(<RouterProvider router={router} />);
    await screen.findByRole("main");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("mounts <OfflineBanner>", async () => {
    setOnline(false);
    const { router } = makeRouter();
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/offline/i);
  });

  // Banner must sit outside <main> so it doesn't contaminate axe's
  // landmark hierarchy.
  it("renders <OfflineBanner> as a sibling of <main>, not inside it", async () => {
    setOnline(false);
    const { router } = makeRouter();
    render(<RouterProvider router={router} />);
    const status = await screen.findByRole("status");
    const main = screen.getByRole("main");
    expect(main.contains(status)).toBe(false);
  });

  // Topbar renders the SICO brand logo so the layout itself owns the
  // brand surface — pages no longer need their own `<h1>SICO</h1>` filler.
  it("renders SICO logo image in the topbar", async () => {
    const { router } = makeRouter();
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("img", { name: /sico/i })).toBeVisible();
  });

  // Marketing gradient must reference `--gradient-auth-page` token, not
  // raw hex literals — designers swap gradients centrally.
  it("uses --gradient-auth-page token (no hardcoded #eef3ff / #d7d4fc literals)", async () => {
    const { router } = makeRouter();
    const { container } = render(<RouterProvider router={router} />);
    await screen.findByRole("main");
    const html = container.innerHTML;
    expect(html).not.toMatch(/#eef3ff/i);
    expect(html).not.toMatch(/#d7d4fc/i);
    expect(html).toMatch(/bg-gradient-auth-page/);
  });
});
