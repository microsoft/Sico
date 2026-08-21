import { toast } from "@sico/ui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditProjectDialog } from "@/features/projects/components/edit-project-dialog";
import { useProjectMutation } from "@/features/projects/hooks/use-project-mutation";
import {
  MemberTypeSchema,
  type ProjectDetail,
} from "@/features/projects/schemas/project";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/projects/hooks/use-project-mutation", () => ({
  useProjectMutation: vi.fn(),
}));

// CoverField (reused from create-project-fields) reads `useApiClient`; wrap so
// the dialog mounts without a real client (uploads aren't exercised here).
function Wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ApiClientProvider client={{} as AxiosInstance}>
      {children}
    </ApiClientProvider>
  );
}

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
    projectMembers: [],
    projectAdmins: [],
    sandboxes: [],
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
  it("submits name/description, omits an unchanged cover, and never operatorAdmins", async () => {
    const mutate = vi.fn();
    mockedUseProjectMutation.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
      { wrapper: Wrapper },
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
        }),
        // The success path passes a mutate options object (onSuccess toast + close).
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      ),
    );
    // The cover wasn't touched, so `iconUri` is OMITTED — echoing the seeded
    // (absolute) URL back would make the backend blank the icon.
    expect(mutate).toHaveBeenCalledWith(
      expect.not.objectContaining({ iconUri: expect.anything() }),
      expect.anything(),
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
      { wrapper: Wrapper },
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Your changes are saved.", {
        invert: true,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes the dialog without mutating when Cancel is clicked", async () => {
    const mutate = vi.fn();
    mockedUseProjectMutation.mockReturnValue(mockMutation({ mutate }));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <EditProjectDialog
        project={makeProject()}
        open
        onOpenChange={onOpenChange}
      />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("disables Save and shows the busy label while pending", () => {
    mockedUseProjectMutation.mockReturnValue(mockMutation({ isPending: true }));
    render(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
      { wrapper: Wrapper },
    );

    const save = screen.getByRole("button", { name: "Saving…" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-busy", "true");
  });

  it("surfaces the save-failure copy on mutation error", () => {
    mockedUseProjectMutation.mockReturnValue(mockMutation({ isError: true }));
    render(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
      { wrapper: Wrapper },
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
      { wrapper: Wrapper },
    );

    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("re-seeds fields from the project when reopened", () => {
    const { rerender } = render(
      <EditProjectDialog project={makeProject()} open onOpenChange={vi.fn()} />,
      { wrapper: Wrapper },
    );
    expect(screen.getByLabelText("Name")).toHaveValue("E-commerce Platform");

    rerender(
      <Wrapper>
        <EditProjectDialog
          project={makeProject({ name: "Atlas" })}
          open={false}
          onOpenChange={vi.fn()}
        />
      </Wrapper>,
    );
    rerender(
      <Wrapper>
        <EditProjectDialog
          project={makeProject({ name: "Atlas" })}
          open
          onOpenChange={vi.fn()}
        />
      </Wrapper>,
    );

    expect(screen.getByLabelText("Name")).toHaveValue("Atlas");
  });
});
