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

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectWorkspaceSkeleton } from "@/features/projects/components/project-workspace-skeleton";

describe("<ProjectWorkspaceSkeleton>", () => {
  it("exposes a single content-shaped loading status for the workspace", () => {
    render(<ProjectWorkspaceSkeleton />);

    expect(
      screen.getByRole("status", { name: /loading project/i }),
    ).toBeInTheDocument();
    // The right panel composes ProjectDrawerSkeleton — it must NOT add its own
    // nested status region (the workspace owns the single one), mirroring the
    // ProjectsGridSkeleton → aria-hidden ProjectCardSkeleton building block.
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("mirrors the drawer on the right by composing ProjectDrawerSkeleton", () => {
    render(<ProjectWorkspaceSkeleton />);

    // The crude 4-bar panel is replaced by the real drawer-shaped skeleton, so
    // the right column does not reflow into the rich ProjectDrawer when the
    // project-detail + knowledge tags queries resolve.
    expect(screen.getByTestId("project-drawer-skeleton")).toBeInTheDocument();
  });
});
