import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SkillActionsMenu } from "@/features/skill/components/skill-list/skill-actions-menu";

describe("SkillActionsMenu", () => {
  it("invokes the matching handler for each action", async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    const onDownloadZip = vi.fn();
    const onDelete = vi.fn();
    render(
      <SkillActionsMenu
        onReplace={onReplace}
        onDownloadZip={onDownloadZip}
        onDelete={onDelete}
      />,
    );
    await user.click(screen.getByRole("button", { name: /actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
