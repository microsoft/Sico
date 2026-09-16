import { i18n } from "@lingui/core";
import { toast } from "@sico/ui";
import {
  act,
  fireEvent,
  render,
  renderHook,
  type RenderHookResult,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { type ReactElement, type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ImageUpload, useImageUpload } from "@/hooks/use-image-upload";
import { type CommonAttachment } from "@/schemas/common-attachment";
import { ApiClientProvider } from "@/services/api-client-context";
import { uploadAttachment } from "@/services/upload-attachment";

vi.mock("@/services/upload-attachment");

function attachment(uri = "default_space/cover.png"): CommonAttachment {
  return {
    name: "cover.png",
    size: 5,
    type: "image/png",
    uri,
    sasUrl: "https://assets.example.test/cover.png",
  };
}

function pendingUpload(): {
  promise: Promise<CommonAttachment>;
  resolve: (value: CommonAttachment) => void;
  reject: (error: Error) => void;
} {
  const resolve = vi.fn<(value: CommonAttachment) => void>();
  const reject = vi.fn<(error: Error) => void>();
  const promise = new Promise<CommonAttachment>((done, fail) => {
    resolve.mockImplementation(done);
    reject.mockImplementation(fail);
  });
  return { promise, resolve, reject };
}

function renderUpload(
  onChange: (uri: string | undefined) => void,
): RenderHookResult<ImageUpload, void> {
  const client = axios.create();

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <StrictMode>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </StrictMode>
    );
  }

  const hook = renderHook<ImageUpload, void>(() => useImageUpload(onChange), {
    wrapper: Wrapper,
  });
  render(
    <input
      ref={hook.result.current.inputRef}
      aria-label="Image file"
      type="file"
      onChange={(event) => {
        void hook.result.current.onPick(event);
      }}
    />,
  );
  return hook;
}

beforeEach(() => {
  vi.mocked(uploadAttachment).mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:current");
  vi.spyOn(URL, "revokeObjectURL").mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("useImageUpload", () => {
  it("uploads a supplied File without a file-input event and returns its URI", async () => {
    vi.mocked(uploadAttachment).mockResolvedValueOnce(attachment());
    const onChange = vi.fn();
    const completed = vi.fn();
    const { result } = renderUpload(onChange);
    const file = new File(["preset"], "preset.png", { type: "image/png" });

    await act(async () => {
      completed(await result.current.uploadFile(file));
    });

    expect(vi.mocked(uploadAttachment).mock.calls[0]?.[1]).toBe(file);
    expect(completed).toHaveBeenCalledWith("default_space/cover.png");
    expect(onChange).toHaveBeenCalledWith("default_space/cover.png");
  });

  it("returns undefined when a supplied File upload fails", async () => {
    vi.mocked(uploadAttachment).mockRejectedValueOnce(
      new Error("Upload failed"),
    );
    const completed = vi.fn();
    const { result } = renderUpload(vi.fn());

    await act(async () => {
      completed(
        await result.current.uploadFile(new File(["preset"], "preset.png")),
      );
    });

    expect(completed).toHaveBeenCalledWith(undefined);
    expect(result.current.uploading).toBe(false);
  });

  it("does not return a URI from a supplied File upload after cancellation", async () => {
    const pending = pendingUpload();
    vi.mocked(uploadAttachment).mockReturnValueOnce(pending.promise);
    const completed = vi.fn();
    const { result } = renderUpload(vi.fn());
    act(() => {
      void result.current
        .uploadFile(new File(["preset"], "preset.png"))
        .then(completed);
    });
    act(result.current.reset);
    await act(async () => pending.resolve(attachment()));

    expect(completed).toHaveBeenCalledWith(undefined);
  });

  it("keeps a local preview and publishes only the current upload URI", async () => {
    const user = userEvent.setup();
    const pending = pendingUpload();
    vi.mocked(uploadAttachment).mockReturnValueOnce(pending.promise);
    const onChange = vi.fn<(uri: string | undefined) => void>();
    const { result } = renderUpload(onChange);
    const file = new File(["cover"], "cover.png", { type: "image/png" });

    await user.upload(screen.getByLabelText("Image file"), file);

    expect(result.current.uploading).toBe(true);
    expect(result.current.preview).toBe("blob:current");
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => pending.resolve(attachment()));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("default_space/cover.png");
    expect(result.current.uploading).toBe(false);
    expect(result.current.preview).toBe("blob:current");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("ignores a cancelled file selection without disturbing an active upload", async () => {
    const user = userEvent.setup();
    vi.mocked(uploadAttachment).mockReturnValueOnce(pendingUpload().promise);
    const onChange = vi.fn<(uri: string | undefined) => void>();
    const { result } = renderUpload(onChange);
    const input = screen.getByLabelText("Image file");
    await user.upload(input, new File(["cover"], "cover.png"));
    const signal = vi.mocked(uploadAttachment).mock.calls[0]?.[2];

    // userEvent skips an unchanged empty selection; exercise the cancel event directly.
    fireEvent.change(input);

    expect(uploadAttachment).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(false);
    expect(result.current.uploading).toBe(true);
    expect(result.current.preview).toBe("blob:current");
    expect(onChange).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("clears a failed image and translates the error at failure time", async () => {
    const user = userEvent.setup();
    const pending = pendingUpload();
    vi.mocked(uploadAttachment).mockReturnValueOnce(pending.promise);
    const errorToast = vi.spyOn(toast, "error");
    const onChange = vi.fn<(uri: string | undefined) => void>();
    const { result } = renderUpload(onChange);
    await user.upload(
      screen.getByLabelText("Image file"),
      new File(["cover"], "cover.png"),
    );

    await act(async () => {
      i18n.loadAndActivate({
        locale: "fr",
        messages: {
          "common.imageUpload.failed":
            "Impossible de téléverser l’image. Réessayez.",
        },
      });
      pending.reject(new Error("Upload failed"));
    });

    expect(result.current.uploading).toBe(false);
    expect(result.current.preview).toBeUndefined();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:current");
    expect(errorToast).toHaveBeenCalledExactlyOnceWith(
      "Impossible de téléverser l’image. Réessayez.",
    );
  });

  it("accepts the same file again after a failed attempt", async () => {
    const user = userEvent.setup();
    vi.mocked(uploadAttachment)
      .mockRejectedValueOnce(new Error("Upload failed"))
      .mockResolvedValueOnce(attachment());
    const onChange = vi.fn<(uri: string | undefined) => void>();
    const { result } = renderUpload(onChange);
    const file = new File(["cover"], "cover.png");
    const input = screen.getByLabelText("Image file");

    await user.upload(input, file);
    await waitFor(() => expect(result.current.uploading).toBe(false));
    expect(input).toHaveValue("");
    await user.upload(input, file);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("default_space/cover.png"),
    );

    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(vi.mocked(uploadAttachment).mock.calls[1]?.[1]).toBe(file);
    expect(input).toHaveValue("");
  });

  it.each(["resolve", "reject"])(
    "ignores a superseded upload's late %s",
    async (outcome) => {
      const user = userEvent.setup();
      const previous = pendingUpload();
      const current = pendingUpload();
      vi.mocked(uploadAttachment)
        .mockReturnValueOnce(previous.promise)
        .mockReturnValueOnce(current.promise);
      vi.mocked(URL.createObjectURL)
        .mockReturnValueOnce("blob:previous")
        .mockReturnValueOnce("blob:current");
      const errorToast = vi.spyOn(toast, "error");
      const onChange = vi.fn<(uri: string | undefined) => void>();
      const { result } = renderUpload(onChange);
      const input = screen.getByLabelText("Image file");
      await user.upload(input, new File(["old"], "old.png"));
      const previousSignal = vi.mocked(uploadAttachment).mock.calls[0]?.[2];
      await user.upload(input, new File(["new"], "new.png"));

      expect(previousSignal?.aborted).toBe(true);
      expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
        "blob:previous",
      );
      await act(async () => {
        if (outcome === "resolve") {
          previous.resolve(attachment("default_space/old.png"));
        } else {
          previous.reject(new Error("Old upload failed"));
        }
      });

      expect(onChange).not.toHaveBeenCalled();
      expect(errorToast).not.toHaveBeenCalled();
      expect(result.current.preview).toBe("blob:current");
      expect(result.current.uploading).toBe(true);
      await act(async () =>
        current.resolve(attachment("default_space/new.png")),
      );
      expect(onChange).toHaveBeenCalledExactlyOnceWith("default_space/new.png");
      expect(result.current.uploading).toBe(false);
    },
  );

  it("keeps reset stable and ignores a pending result after reset", async () => {
    const user = userEvent.setup();
    const pending = pendingUpload();
    vi.mocked(uploadAttachment).mockReturnValueOnce(pending.promise);
    const onChange = vi.fn<(uri: string | undefined) => void>();
    const { result, rerender } = renderUpload(onChange);
    const { reset } = result.current;
    await user.upload(
      screen.getByLabelText("Image file"),
      new File(["cover"], "cover.png"),
    );
    const signal = vi.mocked(uploadAttachment).mock.calls[0]?.[2];
    rerender();
    expect(result.current.reset).toBe(reset);

    act(reset);
    expect(signal?.aborted).toBe(true);
    expect(result.current.preview).toBeUndefined();
    expect(result.current.uploading).toBe(false);
    expect(screen.getByLabelText("Image file")).toHaveValue("");
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:current");
    await act(async () => pending.resolve(attachment()));

    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.preview).toBeUndefined();
    expect(result.current.uploading).toBe(false);
  });

  it("reset revokes a successful preview without changing the committed URI", async () => {
    const user = userEvent.setup();
    vi.mocked(uploadAttachment).mockResolvedValueOnce(attachment());
    const onChange = vi.fn<(uri: string | undefined) => void>();
    const { result } = renderUpload(onChange);
    await user.upload(
      screen.getByLabelText("Image file"),
      new File(["cover"], "cover.png"),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());

    act(result.current.reset);

    expect(result.current.preview).toBeUndefined();
    expect(result.current.uploading).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:current");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("default_space/cover.png");
  });

  it.each(["resolve", "reject"])(
    "cleans up on unmount and ignores a late %s",
    async (outcome) => {
      const user = userEvent.setup();
      const pending = pendingUpload();
      vi.mocked(uploadAttachment).mockReturnValueOnce(pending.promise);
      const errorToast = vi.spyOn(toast, "error");
      const onChange = vi.fn<(uri: string | undefined) => void>();
      const { unmount } = renderUpload(onChange);
      await user.upload(
        screen.getByLabelText("Image file"),
        new File(["cover"], "cover.png"),
      );
      const signal = vi.mocked(uploadAttachment).mock.calls[0]?.[2];

      unmount();

      expect(signal?.aborted).toBe(true);
      expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
        "blob:current",
      );
      await act(async () => {
        if (outcome === "resolve") {
          pending.resolve(attachment());
        } else {
          pending.reject(new Error("Upload failed after unmount"));
        }
      });
      expect(onChange).not.toHaveBeenCalled();
      expect(errorToast).not.toHaveBeenCalled();
    },
  );

  it("does not abort the request when its local preview triggers a rerender", async () => {
    const user = userEvent.setup();
    vi.mocked(uploadAttachment).mockReturnValueOnce(pendingUpload().promise);
    const { result, rerender } = renderUpload(vi.fn());

    await user.upload(
      screen.getByLabelText("Image file"),
      new File(["cover"], "cover.png"),
    );
    rerender();

    expect(result.current.preview).toBe("blob:current");
    expect(result.current.uploading).toBe(true);
    expect(vi.mocked(uploadAttachment).mock.calls[0]?.[2].aborted).toBe(false);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});
