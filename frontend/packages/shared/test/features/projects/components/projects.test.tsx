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
import { afterEach, describe, expect, it, vi } from "vitest";

import { Projects } from "../../../../src/features/projects/components/projects";
import { ProjectsGrid } from "../../../../src/features/projects/components/projects-grid";

vi.mock("../../../../src/features/projects/components/projects-grid", () => ({
  ProjectsGrid: vi.fn(() => <div data-testid="projects-grid" />),
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.mocked(ProjectsGrid).mockImplementation(() => (
    <div data-testid="projects-grid" />
  ));
});

describe("<Projects>", () => {
  it("renders the page <h1> 'Projects' and the subtitle copy", () => {
    render(<Projects />);
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Projects",
    });
    expect(heading.tagName).toBe("H1");
    screen.getByText("Track project performance and knowledge.");
  });

  it("renders the skeleton grid with role='status' and aria-label='Loading projects' on first paint", () => {
    const suspender = Promise.resolve();
    vi.mocked(ProjectsGrid).mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Suspense triggers via thrown Promise
      throw suspender;
    });
    render(<Projects />);
    screen.getByRole("status", { name: "Loading projects" });
  });

  it("renders ErrorView fallback when ProjectsGrid throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ProjectsGrid).mockImplementation(() => {
      throw new Error("boom");
    });
    render(<Projects />);
    screen.getByText("Something went wrong on this page. Try again.");
    spy.mockRestore();
  });
});
