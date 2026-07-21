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
