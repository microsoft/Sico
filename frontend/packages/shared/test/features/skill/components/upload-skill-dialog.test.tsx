import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UploadSkillDialog } from "@/features/skill/components/dialogs/upload-skill-dialog";

describe("UploadSkillDialog", () => {
  it("rejects an unsupported extension and accepts a valid one", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <UploadSkillDialog
        open
        mode="create"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const input = screen.getByLabelText("Skill files");

    await user.upload(
      input,
      new File(["x"], "notes.txt", { type: "text/plain" }),
    );
    expect(screen.getByRole("button", { name: /upload/i })).toBeDisabled();

    const md = new File(["# hi"], "skill.md", { type: "text/markdown" });
    await user.upload(input, md);
    const confirm = screen.getByRole("button", { name: /upload/i });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith([md]);
  });
});
