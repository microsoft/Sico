import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { toast } from "@sico/ui";

import { logger } from "../../../utils/logger";
import type { DwAvatarPreset } from "../constants";

const LOAD_FAILED = msg({
  id: "digitalWorker.avatarPicker.loadFailed",
  message: "We couldn't load the avatar. Try again.",
});

export async function loadAvatarPreset(
  preset: DwAvatarPreset,
  signal: AbortSignal,
): Promise<File | undefined> {
  try {
    const response = await fetch(preset.src, { signal });
    if (!response.ok) {
      throw new Error(`Avatar image request failed: ${response.status}`);
    }
    const image = await response.blob();
    if (signal.aborted) {
      return undefined;
    }
    if (image.type !== "image/png") {
      throw new Error("Expected a bundled PNG avatar");
    }
    return new File([image], `${preset.id}.png`, { type: "image/png" });
  } catch (error) {
    if (!signal.aborted) {
      logger.error("avatar preset load failed", { error });
      toast.error(i18n._(LOAD_FAILED));
    }
    return undefined;
  }
}
