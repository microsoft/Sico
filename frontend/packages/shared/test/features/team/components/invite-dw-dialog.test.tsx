import { toast } from "@sico/ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios, { type AxiosInstance } from "axios";
import { createStore, Provider } from "jotai";
import { type ReactElement, type ReactNode, StrictMode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type MockInstance,
  vi,
} from "vitest";
import type { z } from "zod";

import { userAtom } from "@/atoms/auth-atom";
import { DW_AVATAR_PRESETS } from "@/features/digital-worker/constants";
import type { useCreateAgentInstanceMutation } from "@/features/digital-worker/hooks/use-create-agent-mutation";
import { InviteDwDialog } from "@/features/team/components/invite-dw-dialog";
import type { uploadEnvelopeSchema } from "@/schemas/upload-attachment";
import { ApiClientProvider } from "@/services/api-client-context";

const mutateAsync =
  vi.fn<ReturnType<typeof useCreateAgentInstanceMutation>["mutateAsync"]>();
vi.mock("@/features/digital-worker/hooks/use-create-agent-mutation", () => ({
  useCreateAgentInstanceMutation: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/features/studio/hooks/use-agent-infos-query", () => ({
  useAgentInfosQuery: () => ({
    data: [{ agentId: "tmpl-1", name: "Nova", role: "Researcher" }],
    isPending: false,
    isError: false,
  }),
}));

function uploadResponse(uri = "default_space/team-avatar.png"): {
  data: z.infer<typeof uploadEnvelopeSchema>;
} {
  return {
    data: {
      code: 0,
      msg: "ok",
      data: {
        id: 42,
        uri,
        sasUrl: "https://assets.example.test/team-avatar.png",
        metaInfo: {
          contentType: "image/png",
          fileExt: "png",
          fileName: "avatar.png",
          fileSize: 6,
          fileType: "image",
        },
      },
    },
  };
}

function renderInvite(): ReturnType<typeof render> & {
  post: MockInstance<AxiosInstance["post"]>;
  onOpenChange: Mock<(open: boolean) => void>;
} {
  const store = createStore();
  store.set(userAtom, { id: 1, email: "operator@example.com", roles: [] });
  const client = axios.create();
  const post = vi.spyOn(client, "post").mockResolvedValue(uploadResponse());
  const onOpenChange = vi.fn<(open: boolean) => void>();

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <StrictMode>
        <Provider store={store}>
          <ApiClientProvider client={client}>{children}</ApiClientProvider>
        </Provider>
      </StrictMode>
    );
  }

  const view = render(
    <InviteDwDialog projectId={7} open onOpenChange={onOpenChange} />,
    {
      wrapper: Wrapper,
    },
  );
  return { ...view, post, onOpenChange };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} {
  const resolve = vi.fn<(value: Value) => void>();
  const promise = new Promise<Value>((done) => {
    resolve.mockImplementation(done);
  });
  return { promise, resolve };
}

async function selectWorker(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: "Digital worker" }));
  await user.click(await screen.findByRole("option", { name: /Nova/ }));
}

function avatarResponse(): Response {
  const response = new Response("avatar", {
    headers: { "Content-Type": "image/png" },
  });
  // Keep the downloaded Blob in the same realm as jsdom's File constructor.
  vi.spyOn(response, "blob").mockResolvedValue(
    new Blob(["avatar"], { type: "image/png" }),
  );
  return response;
}

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({ id: 9 });
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    avatarResponse(),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:team-avatar-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("InviteDwDialog avatar upload", () => {
  it("uploads the default PNG on Save and creates under the route project with its URI", async () => {
    const user = userEvent.setup();
    const { post, onOpenChange } = renderInvite();
    await selectWorker(user);
    expect(fetch).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("combobox", { name: "Project" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(fetch).toHaveBeenCalledExactlyOnceWith(DW_AVATAR_PRESETS[0].src, {
      signal: expect.any(AbortSignal),
    });
    expect(post).toHaveBeenCalledExactlyOnceWith(
      "/project/asset",
      expect.any(FormData),
      { signal: expect.any(AbortSignal) },
    );
    const body: unknown = post.mock.calls[0]?.[1];
    if (!(body instanceof FormData)) {
      throw new Error("Avatar upload must send multipart form data");
    }
    const file = body.get("file");
    if (!(file instanceof File)) {
      throw new Error("Avatar upload must contain a File");
    }
    expect(file.name).toBe(`${DW_AVATAR_PRESETS[0].id}.png`);
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(6);
    expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
      agentId: "tmpl-1",
      employerUsername: "operator@example.com",
      name: "Nova",
      role: "Researcher",
      projectId: 7,
      iconUri: "default_space/team-avatar.png",
    });
  });

  it("keeps the invite locked until mutateAsync resolves", async () => {
    const user = userEvent.setup();
    const { post, onOpenChange } = renderInvite();
    const pending = deferred<{ id: number }>();
    mutateAsync.mockReturnValueOnce(pending.promise);
    await selectWorker(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Change avatar" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Shuffle avatar" }),
    ).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "{Enter}");
    const save = screen.getByRole("button", { name: "Saving…" });
    if (!(save instanceof HTMLButtonElement) || !save.form) {
      throw new Error("Save must belong to the invite form");
    }
    save.form.requestSubmit();
    expect(post).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ id: 9 }));

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("ignores old creation completion after Cancel and reopening", async () => {
    const user = userEvent.setup();
    const { rerender, onOpenChange } = renderInvite();
    const success = vi.spyOn(toast, "success");
    const old = deferred<{ id: number }>();
    mutateAsync.mockReturnValueOnce(old.promise);
    await selectWorker(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    rerender(
      <InviteDwDialog projectId={7} open={false} onOpenChange={onOpenChange} />,
    );
    rerender(<InviteDwDialog projectId={7} open onOpenChange={onOpenChange} />);
    onOpenChange.mockClear();
    await act(async () => old.resolve({ id: 9 }));

    expect(success).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("cancels the old upload and resets the preset when the route project changes", async () => {
    const user = userEvent.setup();
    const { post, rerender, onOpenChange } = renderInvite();
    const old = deferred<ReturnType<typeof uploadResponse>>();
    post.mockReturnValueOnce(old.promise);
    await selectWorker(user);
    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    await user.click(screen.getByRole("radio", { name: "Avatar 9" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    rerender(
      <InviteDwDialog projectId={12} open onOpenChange={onOpenChange} />,
    );
    expect(post.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Avatar 1",
    );
    await act(async () =>
      old.resolve(uploadResponse("default_space/old-team.png")),
    );
    expect(mutateAsync).not.toHaveBeenCalled();
    post.mockResolvedValueOnce(uploadResponse("default_space/new-team.png"));
    await selectWorker(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      DW_AVATAR_PRESETS[8].src,
      DW_AVATAR_PRESETS[0].src,
    ]);
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 12,
        iconUri: "default_space/new-team.png",
      }),
    );
  });
});
