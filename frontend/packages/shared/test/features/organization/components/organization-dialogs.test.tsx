import { i18n } from "@lingui/core";
import { toast } from "@sico/ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationUserNotFoundError } from "@/features/membership";
import { EditOrgNameDialog } from "@/features/organization/components/edit-org-name-dialog";
import { InviteMemberDialog } from "@/features/organization/components/invite-org-member-dialog";
import { ApiClientProvider } from "@/services/api-client-context";

const { inviteMutate, updateMutate } = vi.hoisted(() => ({
  inviteMutate: vi.fn(),
  updateMutate: vi.fn(),
}));
const ZH_UPDATE_MESSAGES = {
  "organization.edit.success": "组织已更新。",
};

let mock: MockAdapter | undefined;

type EditDialogRender = ReturnType<typeof render> & {
  client: ReturnType<typeof axios.create>;
  onOpenChange: (open: boolean) => void;
};

function loadedImage(): HTMLImageElement {
  const image = document.createElement("img");
  Object.defineProperty(image, "src", {
    get: () => image.getAttribute("src") ?? "",
    set: (src: string) => {
      image.setAttribute("src", src);
      Object.defineProperty(image, "complete", {
        configurable: true,
        value: true,
      });
      Object.defineProperty(image, "naturalWidth", {
        configurable: true,
        value: 1,
      });
      queueMicrotask(() => image.dispatchEvent(new Event("load")));
    },
  });
  return image;
}

function renderEditDialog(
  props: {
    currentIconUrl?: string | null;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = {},
  client = axios.create(),
): EditDialogRender {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  return {
    client,
    onOpenChange,
    ...render(
      <ApiClientProvider client={client}>
        <EditOrgNameDialog
          organizationId={9}
          currentName="SICO"
          currentIconUrl={props.currentIconUrl}
          open={props.open ?? true}
          onOpenChange={onOpenChange}
        />
      </ApiClientProvider>,
    ),
  };
}

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/organization/hooks/use-invite-organization-member", () => ({
  useInviteOrganizationMember: () => ({
    mutate: inviteMutate,
    isPending: false,
  }),
}));

vi.mock("@/features/organization/hooks/use-update-organization", () => ({
  useUpdateOrganization: () => ({
    mutate: updateMutate,
    isPending: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "Image").mockImplementation(loadedImage);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
});

afterEach(() => {
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("Organization dialogs", () => {
  it("uses uppercase field-label styling in the Invite dialog", () => {
    render(
      <InviteMemberDialog
        organizationId={9}
        orgName="SICO"
        open
        onOpenChange={vi.fn()}
      />,
    );

    for (const label of ["Email", "Role"]) {
      expect(screen.getByText(label)).toHaveClass(
        "text-xs",
        "font-semibold",
        "tracking-wider",
        "uppercase",
      );
    }
    expect(screen.getByRole("combobox")).toHaveTextContent("Operator");
    expect(screen.getByRole("combobox")).not.toHaveTextContent("org_member");
  });

  it("opens the role options only from the select field", async () => {
    const user = userEvent.setup();
    render(
      <InviteMemberDialog
        organizationId={9}
        orgName="SICO"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Role"));
    expect(
      screen.queryByRole("option", { name: /Admin/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Role" }));
    expect(await screen.findByRole("option", { name: /Admin/ })).toBeVisible();
  });

  it("uses composite-option spacing in the role dropdown", async () => {
    const user = userEvent.setup();
    render(
      <InviteMemberDialog
        organizationId={9}
        orgName="SICO"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Role" }));
    const options = await screen.findAllByRole("option");

    for (const option of options) {
      expect(option).toHaveClass("h-auto", "items-start", "py-2", "pl-3.5");
    }
  });

  it("describes the Operator role as collaborating with digital workers", async () => {
    const user = userEvent.setup();
    render(
      <InviteMemberDialog
        organizationId={9}
        orgName="SICO"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Role" }));

    expect(
      await screen.findByText("Can collaborate with digital workers"),
    ).toBeVisible();
  });

  it("uses the Organization dialog width in Invite", () => {
    render(
      <InviteMemberDialog
        organizationId={9}
        orgName="SICO"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveClass("w-130");
  });

  it("toasts an Invite backend error and leaves the dialog open", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <InviteMemberDialog
        organizationId={9}
        orgName="SICO"
        open
        onOpenChange={onOpenChange}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "Email" }), "x@y.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));
    const callbacks = inviteMutate.mock.calls[0]?.[1];
    await act(async () => {
      await callbacks.onError(new OrganizationUserNotFoundError());
    });

    expect(toast.error).toHaveBeenCalledWith(
      "This user hasn't registered yet.",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.queryByText("This user hasn't registered yet."),
    ).not.toBeInTheDocument();
  });

  it("uses Figma width and uppercase label styling in Edit Organization", () => {
    renderEditDialog();

    expect(screen.getByRole("dialog")).toHaveClass("w-130");
    expect(screen.getByText("Organization name")).toHaveClass(
      "text-xs",
      "font-semibold",
      "tracking-wider",
      "uppercase",
    );
  });

  it("shows the current organization avatar", async () => {
    renderEditDialog({
      currentIconUrl: "https://assets.example.test/organizations/9/avatar.png",
    });

    expect(
      await screen.findByTestId("organization-avatar-preview"),
    ).toHaveAttribute(
      "src",
      "https://assets.example.test/organizations/9/avatar.png",
    );
  });

  it("blocks Save and Enter while an avatar upload is pending", async () => {
    const client = axios.create();
    mock = new MockAdapter(client);
    let resolveUpload: ((value: [number, unknown]) => void) | undefined;
    const upload = new Promise<[number, unknown]>((resolve) => {
      resolveUpload = resolve;
    });
    mock.onPost("/project/asset").reply(() => upload);
    const user = userEvent.setup();
    renderEditDialog({}, client);

    await user.upload(
      screen.getByLabelText("Organization avatar file"),
      new File(["avatar"], "avatar.png", { type: "image/png" }),
    );

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.click(save);
    await user.click(
      screen.getByRole("textbox", { name: "Organization name" }),
    );
    await user.keyboard("{Enter}");
    expect(updateMutate).not.toHaveBeenCalled();

    await act(async () => {
      resolveUpload?.([
        200,
        {
          code: 0,
          msg: "ok",
          data: {
            id: 8,
            uri: "organizations/9/avatar.png",
            sasUrl: "https://sas",
            metaInfo: {
              fileName: "avatar.png",
              fileSize: 6,
              fileType: "image",
              contentType: "image/png",
              fileExt: "png",
            },
          },
        },
      ]);
    });
  });

  it("restores the existing avatar after an upload fails", async () => {
    const client = axios.create();
    mock = new MockAdapter(client);
    mock.onPost("/project/asset").reply(200, {
      code: 100003,
      msg: "forbidden",
      data: {
        id: 8,
        uri: "organizations/9/avatar.png",
        sasUrl: "https://sas",
        metaInfo: {
          fileName: "avatar.png",
          fileSize: 6,
          fileType: "image",
          contentType: "image/png",
          fileExt: "png",
        },
      },
    });
    const user = userEvent.setup();
    renderEditDialog(
      {
        currentIconUrl:
          "https://assets.example.test/organizations/9/original-avatar.png",
      },
      client,
    );

    await user.upload(
      screen.getByLabelText("Organization avatar file"),
      new File(["avatar"], "avatar.png", { type: "image/png" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("organization-avatar-preview")).toHaveAttribute(
        "src",
        "https://assets.example.test/organizations/9/original-avatar.png",
      ),
    );
  });

  it("retries an update failure without uploading the avatar again", async () => {
    const client = axios.create();
    mock = new MockAdapter(client);
    mock.onPost("/project/asset").reply(200, {
      code: 0,
      msg: "ok",
      data: {
        id: 8,
        uri: "organizations/9/avatar.png",
        sasUrl: "https://sas",
        metaInfo: {
          fileName: "avatar.png",
          fileSize: 6,
          fileType: "image",
          contentType: "image/png",
          fileExt: "png",
        },
      },
    });
    const user = userEvent.setup();
    renderEditDialog({}, client);

    await user.upload(
      screen.getByLabelText("Organization avatar file"),
      new File(["avatar"], "avatar.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled(),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    const callbacks = updateMutate.mock.calls[0]?.[1];
    await act(async () => {
      await callbacks?.onError(new Error("backend"));
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateMutate).toHaveBeenCalledTimes(2);
    expect(mock.history.post).toHaveLength(1);
  });

  it("resets an uploaded avatar when the dialog closes and reopens", async () => {
    const client = axios.create();
    mock = new MockAdapter(client);
    mock.onPost("/project/asset").reply(200, {
      code: 0,
      msg: "ok",
      data: {
        id: 8,
        uri: "organizations/9/avatar.png",
        sasUrl: "https://sas",
        metaInfo: {
          fileName: "avatar.png",
          fileSize: 6,
          fileType: "image",
          contentType: "image/png",
          fileExt: "png",
        },
      },
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const view = renderEditDialog(
      {
        currentIconUrl:
          "https://assets.example.test/organizations/9/original-avatar.png",
        onOpenChange,
      },
      client,
    );

    await user.upload(
      screen.getByLabelText("Organization avatar file"),
      new File(["avatar"], "avatar.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("organization-avatar-preview")).toHaveAttribute(
        "src",
        "blob:preview",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    view.rerender(
      <ApiClientProvider client={client}>
        <EditOrgNameDialog
          organizationId={9}
          currentName="SICO"
          currentIconUrl="https://assets.example.test/organizations/9/original-avatar.png"
          open={false}
          onOpenChange={onOpenChange}
        />
      </ApiClientProvider>,
    );
    view.rerender(
      <ApiClientProvider client={client}>
        <EditOrgNameDialog
          organizationId={9}
          currentName="SICO"
          currentIconUrl="https://assets.example.test/organizations/9/original-avatar.png"
          open
          onOpenChange={onOpenChange}
        />
      </ApiClientProvider>,
    );

    expect(
      await screen.findByTestId("organization-avatar-preview"),
    ).toHaveAttribute(
      "src",
      "https://assets.example.test/organizations/9/original-avatar.png",
    );
  });

  it("sends the persisted avatar URI instead of its local blob preview", async () => {
    const client = axios.create();
    mock = new MockAdapter(client);
    mock.onPost("/project/asset").reply(200, {
      code: 0,
      msg: "ok",
      data: {
        id: 8,
        uri: "organizations/9/avatar.png",
        sasUrl: "https://sas",
        metaInfo: {
          fileName: "avatar.png",
          fileSize: 6,
          fileType: "image",
          contentType: "image/png",
          fileExt: "png",
        },
      },
    });
    const user = userEvent.setup();
    renderEditDialog({}, client);

    await user.upload(
      screen.getByLabelText("Organization avatar file"),
      new File(["avatar"], "avatar.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled(),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateMutate.mock.calls[0]?.[0]).toEqual({
      name: "SICO",
      iconUri: "organizations/9/avatar.png",
    });
  });

  it("toasts update success and closes the dialog", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderEditDialog({ onOpenChange });

    await user.click(screen.getByRole("button", { name: "Save" }));
    const callbacks = updateMutate.mock.calls[0]?.[1];
    await act(async () => {
      await callbacks?.onSuccess();
    });

    expect(toast.success).toHaveBeenCalledWith("Organization updated.", {
      invert: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("translates update success when the mutation callback runs", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderEditDialog({ onOpenChange });

    await user.click(screen.getByRole("button", { name: "Save" }));
    const callbacks = updateMutate.mock.calls[0]?.[1];
    act(() => {
      i18n.loadAndActivate({
        locale: "zh-CN",
        messages: ZH_UPDATE_MESSAGES,
      });
    });
    await act(async () => {
      await callbacks?.onSuccess();
    });

    expect(toast.success).toHaveBeenCalledWith("组织已更新。", {
      invert: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("toasts an update backend error and leaves the dialog open", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderEditDialog({ onOpenChange });

    await user.click(screen.getByRole("button", { name: "Save" }));
    const callbacks = updateMutate.mock.calls[0]?.[1];
    await act(async () => {
      await callbacks?.onError(new Error("backend"));
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't update this organization.",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Couldn't update this organization."),
    ).not.toBeInTheDocument();
  });
});
