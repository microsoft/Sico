import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DeleteSkillDialog } from "@/features/skill/components/dialogs/delete-skill-dialog";

describe("DeleteSkillDialog", () => {
  it("confirms deletion of the named skill", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DeleteSkillDialog
        open
        skillName="Visual Bot"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    screen.getByText(/Visual Bot/);
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
