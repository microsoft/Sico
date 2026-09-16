import { toast } from "@sico/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { AddDwDialog } from "@/features/digital-worker/components/add-dw-dialog";
import {
  DW_AVATAR_PRESETS,
  type DwAvatarPreset,
} from "@/features/digital-worker/constants";
import type { uploadEnvelopeSchema } from "@/schemas/upload-attachment";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("@/features/projects/hooks/use-projects-query", () => ({
  useProjectsInfiniteQueryNonSuspense: () => ({
    data: {
      pages: [
        {
          items: [
            {
              id: 7,
              name: "Research",
              description: "",
              iconUrl: "",
              memberType: 1,
              agentInstances: [],
            },
          ],
        },
      ],
    },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/features/studio/hooks/use-agent-infos-query", () => ({
  useAgentInfosQuery: () => ({
    data: [{ agentId: "tmpl-1", name: "Nova", role: "Researcher" }],
    isPending: false,
    isError: false,
  }),
}));

function createResponse(): {
  data: { code: number; msg: string; data: { id: number } };
} {
  return { data: { code: 0, msg: "ok", data: { id: 9 } } };
}

function renderDialog(): ReturnType<typeof render> & {
  post: MockInstance<AxiosInstance["post"]>;
  onOpenChange: Mock<(open: boolean) => void>;
} {
  const store = createStore();
  store.set(userAtom, { id: 1, email: "operator@example.com", roles: [] });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const apiClient = axios.create();
  const post = vi.spyOn(apiClient, "post").mockResolvedValue(createResponse());
  const onOpenChange = vi.fn<(open: boolean) => void>();

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <StrictMode>
        <Provider store={store}>
          <QueryClientProvider client={queryClient}>
            <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
          </QueryClientProvider>
        </Provider>
      </StrictMode>
    );
  }

  const view = render(<AddDwDialog open onOpenChange={onOpenChange} />, {
    wrapper: Wrapper,
  });
  return { ...view, post, onOpenChange };
}

async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: "Project" }));
  await user.click(await screen.findByRole("option", { name: "Research" }));
  await user.click(screen.getByRole("combobox", { name: "Digital worker" }));
  await user.click(await screen.findByRole("option", { name: /Nova/ }));
}

function uploadResponse(uri = "default_space/uploaded-avatar.png"): {
  data: z.infer<typeof uploadEnvelopeSchema>;
} {
  return {
    data: {
      code: 0,
      msg: "ok",
      data: {
        id: 42,
        uri,
        sasUrl: "https://assets.example.test/prod/uploaded-avatar.png",
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

function avatarResponse(type = "image/png", status = 200): Response {
  const response = new Response("avatar", {
    status,
    headers: { "Content-Type": type },
  });
  // Node's Response returns a different Blob realm than jsdom's File accepts.
  vi.spyOn(response, "blob").mockResolvedValue(new Blob(["avatar"], { type }));
  return response;
}

function expectUploadedPreset(
  post: MockInstance<AxiosInstance["post"]>,
  preset: DwAvatarPreset,
): void {
  expect(post).toHaveBeenCalledWith("/project/asset", expect.any(FormData), {
    signal: expect.any(AbortSignal),
  });
  const body: unknown = post.mock.calls.find(
    ([url]) => url === "/project/asset",
  )?.[1];
  if (!(body instanceof FormData)) {
    throw new Error("Avatar upload must send multipart form data");
  }
  expect([...body.keys()]).toEqual(["file"]);
  const file = body.get("file");
  if (!(file instanceof File)) {
    throw new Error("Avatar upload must contain a File");
  }
  expect(file.name).toBe(`${preset.id}.png`);
  expect(file.type).toBe("image/png");
  expect(file.size).toBe(6);
}

function requestSubmit(): void {
  const save = screen.getByRole("button", { name: /Sav/ });
  if (!(save instanceof HTMLButtonElement) || !save.form) {
    throw new Error("Save must belong to the DW form");
  }
  save.form.requestSubmit();
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    avatarResponse(),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:avatar-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AddDwDialog avatar", () => {
  it("keeps opening, selecting, and shuffling local until Save", async () => {
    const user = userEvent.setup();
    const { post } = renderDialog();
    expect(fetch).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Avatar file")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Avatar 1",
    );
    await user.click(screen.getByRole("radio", { name: "Avatar 9" }));
    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Avatar 9",
    );
    vi.spyOn(Math, "random").mockReturnValue(0);
    await user.click(screen.getByRole("button", { name: "Shuffle avatar" }));

    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Avatar 1",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    { choice: "default", preset: DW_AVATAR_PRESETS[0] },
    { choice: "selected", preset: DW_AVATAR_PRESETS[8] },
    { choice: "shuffled", preset: DW_AVATAR_PRESETS[1] },
  ])(
    "uploads the $choice PNG on Save and creates with the returned URI",
    async ({ choice, preset }) => {
      const user = userEvent.setup();
      const { post, onOpenChange } = renderDialog();
      post.mockResolvedValueOnce(uploadResponse());
      await fillValidForm(user);
      if (choice === "selected") {
        await user.click(screen.getByRole("button", { name: "Change avatar" }));
        await user.click(screen.getByRole("radio", { name: "Avatar 9" }));
      } else if (choice === "shuffled") {
        vi.spyOn(Math, "random").mockReturnValue(0);
        await user.click(
          screen.getByRole("button", { name: "Shuffle avatar" }),
        );
      }
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(fetch).toHaveBeenCalledExactlyOnceWith(preset.src, {
        signal: expect.any(AbortSignal),
      });
      expectUploadedPreset(post, preset);
      expect(post).toHaveBeenNthCalledWith(2, "/agent/single_agent_instance", {
        agentId: "tmpl-1",
        employerUsername: "operator@example.com",
        name: "Nova",
        projectId: 7,
        role: "Researcher",
        iconUri: "default_space/uploaded-avatar.png",
      });
      expect(post).toHaveBeenCalledTimes(2);
    },
  );

  it("validates required fields before fetching or uploading the avatar", async () => {
    const user = userEvent.setup();
    const { post } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name is required")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    { failure: "an HTTP failure", type: "image/png", status: 404 },
    { failure: "HTML instead of PNG", type: "text/html", status: 200 },
  ])(
    "does not upload or create after $failure while loading the preset",
    async ({ type, status }) => {
      const user = userEvent.setup();
      const { post } = renderDialog();
      const error = vi.spyOn(toast, "error");
      vi.mocked(fetch).mockResolvedValueOnce(avatarResponse(type, status));
      await fillValidForm(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          "We couldn't load the avatar. Try again.",
        ),
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
      expect(post).not.toHaveBeenCalled();
    },
  );

  it("preserves the selected preset after upload failure and retries it on Save", async () => {
    const user = userEvent.setup();
    const { post } = renderDialog();
    const error = vi.spyOn(toast, "error");
    post.mockRejectedValueOnce(new Error("Upload failed"));
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    await user.click(screen.getByRole("radio", { name: "Avatar 9" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "We couldn't upload the image. Try again.",
      ),
    );

    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Avatar 9",
    );
    expect(post).toHaveBeenCalledTimes(1);
    post.mockResolvedValueOnce(uploadResponse());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      DW_AVATAR_PRESETS[8].src,
      DW_AVATAR_PRESETS[8].src,
    ]);
    expect(post).toHaveBeenLastCalledWith(
      "/agent/single_agent_instance",
      expect.objectContaining({ iconUri: "default_space/uploaded-avatar.png" }),
    );
  });

  it.each([
    { stage: "asset load", posts: 0 },
    { stage: "upload", posts: 1 },
    { stage: "creation", posts: 2 },
  ])(
    "locks controls and rejects duplicate submits during $stage",
    async ({ stage, posts }) => {
      const user = userEvent.setup();
      const { post } = renderDialog();
      const load = deferred<Response>();
      const upload = deferred<ReturnType<typeof uploadResponse>>();
      const create = deferred<ReturnType<typeof createResponse>>();
      if (stage === "asset load") {
        vi.mocked(fetch).mockReturnValueOnce(load.promise);
      }
      post.mockReturnValueOnce(
        stage === "upload" ? upload.promise : Promise.resolve(uploadResponse()),
      );
      post.mockReturnValueOnce(create.promise);
      await fillValidForm(user);
      await user.click(screen.getByRole("button", { name: "Change avatar" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByRole("button", { name: "Saving…" });
      await waitFor(() => expect(post).toHaveBeenCalledTimes(posts));

      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Change avatar" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Shuffle avatar" }),
      ).toBeDisabled();
      for (const radio of screen.getAllByRole("radio")) {
        expect(radio).toBeDisabled();
      }
      await user.type(screen.getByRole("textbox", { name: "Name" }), "{Enter}");
      requestSubmit();
      requestSubmit();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledTimes(posts);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
    },
  );

  it("aborts a pending preset fetch on Cancel and ignores it after reopening", async () => {
    const user = userEvent.setup();
    const { post, rerender, onOpenChange } = renderDialog();
    const old = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(old.promise);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<AddDwDialog open={false} onOpenChange={onOpenChange} />);
    rerender(<AddDwDialog open onOpenChange={onOpenChange} />);
    await act(async () => old.resolve(avatarResponse()));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("aborts a pending preset fetch on unmount without starting an upload", async () => {
    const user = userEvent.setup();
    const { post, unmount } = renderDialog();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => pending.resolve(avatarResponse()));

    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it("aborts an upload on Cancel and ignores its URI after a new save", async () => {
    const user = userEvent.setup();
    const { post, rerender, onOpenChange } = renderDialog();
    const old = deferred<ReturnType<typeof uploadResponse>>();
    post.mockReturnValueOnce(old.promise);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(post.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:avatar-preview");
    rerender(<AddDwDialog open={false} onOpenChange={onOpenChange} />);
    rerender(<AddDwDialog open onOpenChange={onOpenChange} />);
    post.mockResolvedValueOnce(uploadResponse("default_space/new.png"));
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    await act(async () => old.resolve(uploadResponse("default_space/old.png")));

    expect(post).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenLastCalledWith(
      "/agent/single_agent_instance",
      expect.objectContaining({ iconUri: "default_space/new.png" }),
    );
  });

  it("resets the selected avatar to the first preset on reopening", async () => {
    const user = userEvent.setup();
    const { post, rerender, onOpenChange } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    await user.click(screen.getByRole("radio", { name: "Avatar 9" }));
    rerender(<AddDwDialog open={false} onOpenChange={onOpenChange} />);
    rerender(<AddDwDialog open onOpenChange={onOpenChange} />);
    post.mockResolvedValueOnce(uploadResponse());
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

    expect(fetch).toHaveBeenCalledExactlyOnceWith(DW_AVATAR_PRESETS[0].src, {
      signal: expect.any(AbortSignal),
    });
    expectUploadedPreset(post, DW_AVATAR_PRESETS[0]);
  });

  it("does not toast or close the reopened dialog when old creation completes", async () => {
    const user = userEvent.setup();
    const { post, rerender, onOpenChange } = renderDialog();
    const success = vi.spyOn(toast, "success");
    const old = deferred<ReturnType<typeof createResponse>>();
    post
      .mockResolvedValueOnce(uploadResponse())
      .mockReturnValueOnce(old.promise);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    rerender(<AddDwDialog open={false} onOpenChange={onOpenChange} />);
    rerender(<AddDwDialog open onOpenChange={onOpenChange} />);
    onOpenChange.mockClear();
    await act(async () => old.resolve(createResponse()));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );

    expect(success).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});
