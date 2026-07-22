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
