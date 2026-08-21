import { toast } from "@sico/ui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findUserByEmail } from "@/features/rbac/services/user-role";
import { InviteMemberDialog } from "@/features/team/components/invite-member-dialog";
import { useInviteMemberMutation } from "@/features/team/hooks/use-invite-member-mutation";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/team/hooks/use-invite-member-mutation", () => ({
  useInviteMemberMutation: vi.fn(),
}));

vi.mock("@/features/rbac/services/user-role", () => ({
  findUserByEmail: vi.fn(),
}));

const mockedUseInviteMemberMutation = vi.mocked(useInviteMemberMutation);
const mockedFindUserByEmail = vi.mocked(findUserByEmail);

function mockMutation(
  overrides: Partial<ReturnType<typeof useInviteMemberMutation>> = {},
): ReturnType<typeof useInviteMemberMutation> {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof useInviteMemberMutation>;
}

function renderDialog(ui: ReactElement): void {
  render(
    <ApiClientProvider client={{} as AxiosInstance}>{ui}</ApiClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseInviteMemberMutation.mockReturnValue(mockMutation());
});

describe("InviteMemberDialog", () => {
  it("titles the dialog with the project name", () => {
    renderDialog(
      <InviteMemberDialog
        projectId={7}
        projectName="Acme"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading")).toHaveTextContent("Invite to Acme");
  });

  it("offers Admin and Member role options, defaulting to Member", async () => {
    const user = userEvent.setup();
    renderDialog(
      <InviteMemberDialog
        projectId={7}
        projectName="Acme"
        open
        onOpenChange={vi.fn()}
      />,
    );

    const roleTrigger = screen.getByRole("button", { name: "Role" });
    expect(roleTrigger).toHaveTextContent("Member");

    await user.click(roleTrigger);
    expect(
      await screen.findByRole("menuitemradio", { name: "Admin" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemradio", { name: "Member" }),
    ).toBeInTheDocument();
  });

  it("closes the menu and updates the trigger after picking a role", async () => {
    const user = userEvent.setup();
    renderDialog(
      <InviteMemberDialog
        projectId={7}
        projectName="Acme"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Role" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Admin" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Role" })).toHaveTextContent(
      "Admin",
    );
  });

  it("disables Invite until an email is entered", async () => {
    const user = userEvent.setup();
    renderDialog(
      <InviteMemberDialog
        projectId={7}
        projectName="Acme"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled();

    await user.type(screen.getByLabelText("Email"), "teammate@company.com");

    expect(screen.getByRole("button", { name: "Invite" })).toBeEnabled();
  });

  it("rejects a malformed email with the format error", async () => {
    const user = userEvent.setup();
    renderDialog(
      <InviteMemberDialog
        projectId={7}
        projectName="Acme"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Email"), "notanemail");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    expect(await screen.findByText("Enter a valid email")).toBeInTheDocument();
    expect(mockedFindUserByEmail).not.toHaveBeenCalled();
  });

  it("toasts and skips the invite when the email is unregistered", async () => {
    mockedFindUserByEmail.mockResolvedValue(null);
    const mutate = vi.fn();
    mockedUseInviteMemberMutation.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    renderDialog(
      <InviteMemberDialog
        projectId={7}
        projectName="Acme"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Email"), "ghost@company.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "This user isn't registered yet.",
      ),
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("invites the resolved user with their id and the default role", async () => {
    mockedFindUserByEmail.mockResolvedValue({
      id: 42,
      email: "teammate@company.com",
    });
    const mutate = vi.fn();
    mockedUseInviteMemberMutation.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    renderDialog(
      <InviteMemberDialog
        projectId={7}
        projectName="Acme"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Email"), "teammate@company.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        { userId: 42, roleCode: "project_member" },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      ),
    );
  });
});
