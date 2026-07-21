import { toast } from "@sico/ui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditProjectDialog } from "@/features/projects/components/edit-project-dialog";
import { useProjectMutation } from "@/features/projects/hooks/use-project-mutation";
import {
  MemberTypeSchema,
  type ProjectDetail,
} from "@/features/projects/schemas/project";

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/projects/hooks/use-project-mutation", () => ({
  useProjectMutation: vi.fn(),
}));

const mockedUseProjectMutation = vi.mocked(useProjectMutation);

function mockMutation(
  overrides: Partial<ReturnType<typeof useProjectMutation>> = {},
): ReturnType<typeof useProjectMutation> {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof useProjectMutation>;
}

function makeProject(partial: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 1,
    name: "E-commerce Platform",
    description: "A short project summary.",
    iconUrl: "",
    memberType: MemberTypeSchema.enum.OWNER,
    agentInstances: [{ id: 1, iconUrl: "" }],
    ownerUsername: "owner@microsoft.com",
    creatorUsername: "amy@microsoft.com",
    operatorAdmins: ["jess@microsoft.com"],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseProjectMutation.mockReturnValue(mockMutation());
});

describe("EditProjectDialog", () => {
  it("submits name/description/iconUri but never operatorAdmins", async () => {
    const mutate = vi.fn();
    mockedUseProjectMutation.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
    );

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Renamed",
          description: "A short project summary.",
          iconUri: "",
        }),
        // The success path passes a mutate options object (onSuccess toast + close).
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      ),
    );
    expect(mutate).toHaveBeenCalledWith(
      expect.not.objectContaining({ operatorAdmins: expect.anything() }),
      expect.anything(),
    );
  });

  it("on a successful save it toasts and closes the dialog", async () => {
    const mutate = vi.fn((_vars, opts) => opts?.onSuccess?.(1));
    mockedUseProjectMutation.mockReturnValue(mockMutation({ mutate }));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <EditProjectDialog
        project={makeProject()}
        open
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Your changes are saved.", {
        invert: true,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables Save and shows the busy label while pending", () => {
    mockedUseProjectMutation.mockReturnValue(mockMutation({ isPending: true }));
    render(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
    );

    const save = screen.getByRole("button", { name: "Saving…" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-busy", "true");
  });

  it("surfaces the save-failure copy on mutation error", () => {
    mockedUseProjectMutation.mockReturnValue(mockMutation({ isError: true }));
    render(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
    );

    expect(
      screen.getByText("We couldn't save your changes. Try again."),
    ).toBeInTheDocument();
  });

  it("blocks submit and skips the mutation when name is empty", async () => {
    const mutate = vi.fn();
    mockedUseProjectMutation.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
    );

    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("adds operators as the full deduped set via the inline control", async () => {
    const mutate = vi.fn();
    mockedUseProjectMutation.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(
      <EditProjectDialog
        project={makeProject({ operatorAdmins: ["jess@microsoft.com"] })}
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add operator" }));
    await user.type(
      screen.getByPlaceholderText("Add comma separated emails"),
      "jess@microsoft.com, amy@microsoft.com",
    );
    await user.click(screen.getByRole("button", { name: "Confirm operators" }));

    // jess already exists → deduped to one; amy appended.
    expect(mutate).toHaveBeenCalledWith({
      operatorAdmins: ["jess@microsoft.com", "amy@microsoft.com"],
    });
  });

  it("re-seeds fields and collapses the operator adder when reopened", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
    );
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Renamed");
    await user.click(screen.getByRole("button", { name: "Add operator" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Renamed");

    rerender(
      <EditProjectDialog
        project={makeProject()}
        open={false}
        onOpenChange={vi.fn()}
      />,
    );
    rerender(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
    );

    expect(screen.getByLabelText("Name")).toHaveValue("E-commerce Platform");
    expect(
      screen.getByRole("button", { name: "Add operator" }),
    ).toBeInTheDocument();
  });

  it("discards typed operators on cancel without mutating", async () => {
    const mutate = vi.fn();
    mockedUseProjectMutation.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Add operator" }));
    await user.type(
      screen.getByPlaceholderText("Add comma separated emails"),
      "x@y.com",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mutate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Add operator" }),
    ).toBeInTheDocument();
  });

  it("does not mutate when confirming an empty operator input", async () => {
    const mutate = vi.fn();
    mockedUseProjectMutation.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Add operator" }));
    await user.click(screen.getByRole("button", { name: "Confirm operators" }));
    expect(mutate).not.toHaveBeenCalled();
  });
});
