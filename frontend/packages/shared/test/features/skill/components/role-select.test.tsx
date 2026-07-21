import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RoleSelect } from "@/features/skill/components/setup/role-select";

const roles = [
  { name: "Tester", value: "tester" },
  { name: "Dev", value: "dev" },
];

describe("RoleSelect", () => {
  it("shows the selected role and reports a change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RoleSelect value="tester" options={roles} onChange={onChange} />);
    // The trigger echoes the selected option's label, not the raw value.
    screen.getByText("Tester");
    await user.click(screen.getByLabelText("Role"));
    await user.click(await screen.findByRole("option", { name: "Dev" }));
    expect(onChange).toHaveBeenCalledWith("dev");
  });
});
