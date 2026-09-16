import { toast } from "@sico/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DW_AVATAR_PRESETS } from "@/features/digital-worker/constants";
import { loadAvatarPreset } from "@/features/digital-worker/services/load-avatar-preset";

const fetchImage = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchImage.mockReset();
  vi.stubGlobal("fetch", fetchImage);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("loadAvatarPreset", () => {
  it("loads the selected bundled asset as a named PNG File", async () => {
    const preset = DW_AVATAR_PRESETS[2];
    const response = new Response(null, { status: 200 });
    const image = new Blob(["preset"], { type: "image/png" });
    vi.spyOn(response, "blob").mockResolvedValue(image);
    fetchImage.mockResolvedValue(response);
    const controller = new AbortController();

    const file = await loadAvatarPreset(preset, controller.signal);

    expect(fetchImage).toHaveBeenCalledWith(preset.src, {
      signal: controller.signal,
    });
    expect(file).toBeInstanceOf(File);
    expect(file?.name).toBe(`${preset.id}.png`);
    expect(file?.type).toBe("image/png");
    expect(file?.size).toBe(image.size);
  });

  it("reports a failed asset request without producing an upload file", async () => {
    fetchImage.mockResolvedValue(new Response(null, { status: 404 }));
    const error = vi.spyOn(toast, "error");

    const file = await loadAvatarPreset(
      DW_AVATAR_PRESETS[0],
      new AbortController().signal,
    );

    expect(file).toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "We couldn't load the avatar. Try again.",
    );
  });

  it("rejects an HTML fallback instead of uploading it as a PNG", async () => {
    fetchImage.mockResolvedValue(
      new Response("<html></html>", {
        headers: { "Content-Type": "text/html" },
      }),
    );

    const file = await loadAvatarPreset(
      DW_AVATAR_PRESETS[0],
      new AbortController().signal,
    );

    expect(file).toBeUndefined();
  });

  it("does not produce a file from an already cancelled request", async () => {
    const response = new Response(null, { status: 200 });
    vi.spyOn(response, "blob").mockResolvedValue(
      new Blob(["png"], { type: "image/png" }),
    );
    fetchImage.mockResolvedValue(response);
    const controller = new AbortController();
    controller.abort();
    const error = vi.spyOn(toast, "error");

    const file = await loadAvatarPreset(
      DW_AVATAR_PRESETS[0],
      controller.signal,
    );

    expect(file).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });
});
