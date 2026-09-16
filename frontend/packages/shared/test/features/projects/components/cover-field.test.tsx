import { toast } from "@sico/ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios, { type AxiosInstance } from "axios";
import { type ReactElement, type ReactNode, StrictMode } from "react";
import {
  afterEach,
  describe,
  expect,
  it,
  type Mock,
  type MockInstance,
  vi,
} from "vitest";
import type { z } from "zod";

import { CoverField } from "@/features/projects/components/cover-field";
import type { uploadEnvelopeSchema } from "@/schemas/upload-attachment";
import { ApiClientProvider } from "@/services/api-client-context";

function uploadResponse(): { data: z.infer<typeof uploadEnvelopeSchema> } {
  return {
    data: {
      code: 0,
      msg: "ok",
      data: {
        id: 42,
        uri: "default_space/project-cover.png",
        sasUrl: "https://assets.example.test/project-cover.png",
        metaInfo: {
          contentType: "image/png",
          fileExt: "png",
          fileName: "cover.png",
          fileSize: 5,
          fileType: "image",
        },
      },
    },
  };
}

function renderCover(value?: string): ReturnType<typeof render> & {
  post: MockInstance<AxiosInstance["post"]>;
  onChange: Mock<(uri: string | undefined) => void>;
} {
  const client = axios.create();
  const post = vi.spyOn(client, "post");
  const onChange = vi.fn<(uri: string | undefined) => void>();

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <StrictMode>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </StrictMode>
    );
  }

  const view = render(<CoverField value={value} onChange={onChange} />, {
    wrapper: Wrapper,
  });
  return { ...view, post, onChange };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CoverField", () => {
  it("uploads a multipart cover and commits only its URI after the pending state", async () => {
    const user = userEvent.setup();
    const { post, onChange, rerender } = renderCover();
    const complete =
      vi.fn<(value: ReturnType<typeof uploadResponse>) => void>();
    post.mockReturnValueOnce(
      new Promise<ReturnType<typeof uploadResponse>>((resolve) => {
        complete.mockImplementation(resolve);
      }),
    );
    const file = new File(["cover"], "cover.png", { type: "image/png" });
    expect(screen.getByText("Project cover")).toBeVisible();
    expect(screen.getByText("Upload a cover")).toBeVisible();

    await user.upload(screen.getByLabelText("Project cover file"), file);

    expect(screen.getByText("Uploading…")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Choose project cover" }),
    ).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledExactlyOnceWith(
      "/project/asset",
      expect.any(FormData),
      {
        signal: expect.any(AbortSignal),
      },
    );
    const body: unknown = post.mock.calls[0]?.[1];
    if (!(body instanceof FormData)) {
      throw new Error("Cover upload must send multipart form data");
    }
    expect(body.get("file")).toBe(file);
    expect([...body.keys()]).toEqual(["file"]);
    await act(async () => complete(uploadResponse()));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      "default_space/project-cover.png",
    );
    rerender(
      <CoverField
        value="default_space/project-cover.png"
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Change cover")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Choose project cover" }),
    ).toBeEnabled();
  });

  it("restores the project picker after failure and retries the same file", async () => {
    const user = userEvent.setup();
    const { post, onChange } = renderCover();
    const errorToast = vi.spyOn(toast, "error");
    post
      .mockRejectedValueOnce(new Error("Upload failed"))
      .mockResolvedValueOnce(uploadResponse());
    const file = new File(["cover"], "cover.png", { type: "image/png" });
    const input = screen.getByLabelText("Project cover file");

    await user.upload(input, file);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined),
    );

    expect(errorToast).toHaveBeenCalledExactlyOnceWith(
      "We couldn't upload the image. Try again.",
    );
    expect(screen.getByText("Upload a cover")).toBeVisible();
    expect(screen.getByText("Project cover")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Choose project cover" }),
    ).toBeEnabled();
    expect(input).toHaveValue("");
    await user.upload(input, file);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        "default_space/project-cover.png",
      ),
    );

    expect(post).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Uploading…")).not.toBeInTheDocument();
  });

  it("preserves the existing-cover label and opens the image-only file picker", async () => {
    const user = userEvent.setup();
    const { post, onChange } = renderCover("default_space/existing.png");
    const input = screen.getByLabelText("Project cover file");
    const click = vi.spyOn(input, "click");

    expect(screen.getByText("Change cover")).toBeVisible();
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("type", "file");
    await user.click(
      screen.getByRole("button", { name: "Choose project cover" }),
    );

    expect(click).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
