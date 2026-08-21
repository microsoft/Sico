import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SetupBasicInfo } from "@/features/skill/components/setup/setup-basic-info";

const roles = [
  { name: "Tester", value: "tester" },
  { name: "Developer", value: "developer" },
];

// `role` is a domain prop (the skill-author role), not an ARIA role; binding it
// through a variable keeps jsx-a11y/aria-role from misreading the literal.
const emptyRole = "";

describe("SetupBasicInfo", () => {
  it("saves the draft via the Save button once both fields are filled", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SetupBasicInfo
        name=""
        role={emptyRole}
        roleOptions={roles}
        onSave={onSave}
      />,
    );

    // Empty form: Save is disabled and reads "Saved" (legacy parity).
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    await user.type(screen.getByLabelText(/original name/i), "Visual Bot");
    await user.click(screen.getByLabelText("Role"));
    await user.click(await screen.findByRole("option", { name: "Tester" }));

    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await user.click(save);

    expect(onSave).toHaveBeenCalledWith({ name: "Visual Bot", role: "tester" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled(),
    );
  });
});
