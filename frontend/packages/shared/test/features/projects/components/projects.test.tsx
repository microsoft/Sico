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
