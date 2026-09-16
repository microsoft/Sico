import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProjectDialogOpenAtom } from "@/features/projects/atoms/create-project-dialog-atom";

import { Projects } from "../../../../src/features/projects/components/projects";
import { ProjectsGrid } from "../../../../src/features/projects/components/projects-grid";

let organization: { id: number } | null | undefined;
let organizationError: Error | null = null;

vi.mock("@/hooks/use-bound-organization", () => ({
  useBoundOrganizationQuery: () => ({
    data: organization,
    isError: organizationError !== null,
    error: organizationError,
  }),
}));

beforeEach(() => {
  organization = { id: 9 };
  organizationError = null;
  getDefaultStore().set(createProjectDialogOpenAtom, false);
});

vi.mock("../../../../src/features/projects/components/projects-grid", () => ({
  ProjectsGrid: vi.fn(() => <div data-testid="projects-grid" />),
}));

vi.mock(
  "../../../../src/features/projects/components/create-project-dialog",
  () => ({
    CreateProjectDialog: ({
      open,
      onOpenChange,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) =>
      open ? (
        <div role="dialog" aria-label="Create Project">
          <button type="button" onClick={() => onOpenChange(false)}>
            Close create project
          </button>
        </div>
      ) : null,
  }),
);

afterEach(() => {
  vi.resetAllMocks();
  vi.mocked(ProjectsGrid).mockImplementation(() => (
    <div data-testid="projects-grid" />
  ));
});

describe("<Projects>", () => {
  it.each([undefined, null])(
    "hides creation when the resolved organization is %s",
    (unavailable) => {
      organization = unavailable;
      render(<Projects />);

      expect(
        screen.queryByRole("button", { name: "Create Project" }),
      ).not.toBeInTheDocument();
      expect(vi.mocked(ProjectsGrid).mock.lastCall?.[0]).toEqual(
        expect.objectContaining({ onCreate: undefined }),
      );
    },
  );

  it("keeps the project list visible when organization loading fails", () => {
    organization = undefined;
    organizationError = new Error("organization request failed");
    getDefaultStore().set(createProjectDialogOpenAtom, true);
    render(<Projects />);

    expect(screen.getByTestId("projects-grid")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps creation available when an organization refetch fails with cached data", async () => {
    organizationError = new Error("organization refetch failed");
    const user = userEvent.setup();
    render(<Projects />);

    await user.click(screen.getByRole("button", { name: "Create Project" }));

    expect(
      screen.getByRole("dialog", { name: "Create Project" }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("waits for a valid organization before honoring an external create request", () => {
    organization = undefined;
    getDefaultStore().set(createProjectDialogOpenAtom, true);
    const { rerender } = render(<Projects />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    organization = { id: 9 };
    rerender(<Projects />);

    expect(
      screen.getByRole("dialog", { name: "Create Project" }),
    ).toBeVisible();
  });

  it("renders the page <h1> 'Projects' and the subtitle copy", () => {
    render(<Projects />);
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Projects",
    });
    expect(heading.tagName).toBe("H1");
    screen.getByText("Track project performance and knowledge.");
  });

  it("blurs the page title while the create dialog is open", async () => {
    const user = userEvent.setup();
    render(<Projects />);
    const heading = screen.getByRole("heading", { level: 1, name: "Projects" });
    const titleGroup = heading.parentElement;

    expect(titleGroup).not.toHaveClass("blur-xs");

    await user.click(screen.getByRole("button", { name: "Create Project" }));
    await screen.findByRole("dialog", { name: "Create Project" });
    expect(titleGroup).toHaveClass("blur-xs");

    await user.click(
      screen.getByRole("button", { name: "Close create project" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(titleGroup).not.toHaveClass("blur-xs");
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
