import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectCard } from "../../../../src/features/projects/components/project-card";
import type { Project } from "../../../../src/features/projects/schemas/project";

const baseProject: Project = {
  id: 42,
  name: "Atlas",
  description: "Mission control for digital workers",
  iconUrl: "",
  memberType: 3,
  agentInstances: [],
};

function makeRouter(ui: React.ReactNode): AnyRouter {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/project/$projectId",
    component: () => <Outlet />,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([projectRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

function renderCard(project: Project): ReturnType<typeof render> {
  const router = makeRouter(<ProjectCard project={project} />);
  return render(<RouterProvider router={router} />);
}

describe("<ProjectCard>", () => {
  it("renders name, description, and a link to /project/$id", async () => {
    renderCard(baseProject);
    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe("/project/42");
    expect(link).toHaveTextContent("Atlas");
    expect(link).toHaveTextContent("Mission control for digital workers");
  });

  it("truncates long text via title attributes", async () => {
    renderCard(baseProject);
    await screen.findByRole("link");
    expect(screen.getByText("Atlas").getAttribute("title")).toBe("Atlas");
    expect(
      screen
        .getByText("Mission control for digital workers")
        .getAttribute("title"),
    ).toBe("Mission control for digital workers");
  });

  it("renders all agent avatars when count <= 3 and omits the +N badge", async () => {
    renderCard({
      ...baseProject,
      agentInstances: [
        { id: 1, iconUrl: "a" },
        { id: 2, iconUrl: "b" },
        { id: 3, iconUrl: "c" },
      ],
    });
    await screen.findByRole("link");
    const group = screen.getByTestId("project-card-avatar-group");
    expect(within(group).getAllByTestId("avatar-root")).toHaveLength(3);
    expect(screen.queryByLabelText(/more agents/)).toBeNull();
  });

  it("renders 3 avatars + a '+N' badge with aria-label='{N} more agents' when count > 3", async () => {
    renderCard({
      ...baseProject,
      agentInstances: [
        { id: 1, iconUrl: "a" },
        { id: 2, iconUrl: "b" },
        { id: 3, iconUrl: "c" },
        { id: 4, iconUrl: "d" },
        { id: 5, iconUrl: "e" },
      ],
    });
    await screen.findByRole("link");
    const group = screen.getByTestId("project-card-avatar-group");
    expect(within(group).getAllByTestId("avatar-root")).toHaveLength(3);
    const overflow = screen.getByLabelText("2 more agents");
    expect(overflow).toHaveTextContent("+2");
  });

  it("renders no avatar row when agentInstances is empty", async () => {
    renderCard(baseProject);
    await screen.findByRole("link");
    expect(screen.queryByTestId("project-card-avatar-group")).toBeNull();
    expect(screen.queryByLabelText(/more agents/)).toBeNull();
  });
});
