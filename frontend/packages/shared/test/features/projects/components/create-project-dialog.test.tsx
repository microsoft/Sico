import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import type { useCreateProjectMutation } from "@/features/projects/hooks/use-create-project-mutation";

const mutate = vi.fn<ReturnType<typeof useCreateProjectMutation>["mutate"]>();
let mutationPending = false;

vi.mock("@/features/projects/hooks/use-create-project-mutation", () => ({
  useCreateProjectMutation: () => ({ mutate, isPending: mutationPending }),
}));
vi.mock("@/features/projects/components/cover-field", () => ({
  CoverField: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mutationPending = false;
});

describe("CreateProjectDialog", () => {
  it("submits the supplied organization ID with the form values", async () => {
    const user = userEvent.setup();
    render(
      <CreateProjectDialog organizationId={42} open onOpenChange={vi.fn()} />,
    );

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Aurora");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        {
          name: "Aurora",
          description: "",
          iconUri: undefined,
          organizationId: 42,
        },
        expect.any(Object),
      ),
    );
  });

  it("uses the latest organization prop when submitting", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <CreateProjectDialog
        organizationId={42}
        open
        onOpenChange={onOpenChange}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Aurora");

    rerender(
      <CreateProjectDialog
        organizationId={43}
        open
        onOpenChange={onOpenChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Aurora", organizationId: 43 }),
        expect.any(Object),
      ),
    );
  });

  it("disables Save while a creation is pending", () => {
    mutationPending = true;
    render(
      <CreateProjectDialog organizationId={42} open onOpenChange={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });
});
