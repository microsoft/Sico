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

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, type Mock, vi } from "vitest";

import { ConfirmDialog } from "@/features/projects/components/confirm-dialog";

const TITLE = "Delete Knowledge";
const BODY =
  "Permanently remove access to this knowledge across your organization.";

function setup(args: { pending?: boolean }): {
  user: ReturnType<typeof userEvent.setup>;
  onConfirm: Mock;
  onOpenChange: Mock;
} {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={TITLE}
      body={BODY}
      onConfirm={onConfirm}
      pending={args.pending ?? false}
    />,
  );
  return { user, onConfirm, onOpenChange };
}

describe("<ConfirmDialog>", () => {
  it("renders the consumer-provided title and body", () => {
    setup({});

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.getByText(BODY)).toBeInTheDocument();
  });

  it("clicking Delete signals intent via onConfirm", async () => {
    const { user, onConfirm, onOpenChange } = setup({});

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("while pending the action reads 'Deleting…' and is disabled", () => {
    setup({ pending: true });

    const action = screen.getByRole("button", { name: /deleting…/i });
    expect(action).toBeDisabled();
  });

  it("clicking Cancel requests close without confirming", async () => {
    const { user, onConfirm, onOpenChange } = setup({});

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalled();
    expect(onOpenChange.mock.lastCall?.[0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
