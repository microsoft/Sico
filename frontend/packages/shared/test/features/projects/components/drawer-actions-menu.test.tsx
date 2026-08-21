import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DrawerActionsMenu } from "@/features/projects/components/drawer-actions-menu";

afterEach(cleanup);

describe("DrawerActionsMenu", () => {
  it("shows a Delete project item for an admin", async () => {
    const user = userEvent.setup();
    render(<DrawerActionsMenu canManageProject onRequestDelete={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "Delete project" }),
    ).toBeInTheDocument();
  });

  it("renders nothing for a non-admin", () => {
    render(
      <DrawerActionsMenu canManageProject={false} onRequestDelete={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: "Project actions" }),
    ).not.toBeInTheDocument();
  });

  it("raises onRequestDelete when Delete project is clicked", async () => {
    const onRequestDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <DrawerActionsMenu canManageProject onRequestDelete={onRequestDelete} />,
    );
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete project" }),
    );
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
  });
});
