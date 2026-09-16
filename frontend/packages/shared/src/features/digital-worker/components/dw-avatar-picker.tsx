import { Trans, useLingui } from "@lingui/react/macro";
import { Loader2, Shuffle } from "lucide-react";
import { type JSX, useId, useState } from "react";

import { DwAvatarGrid } from "./dw-avatar-grid";
import { DwAvatar } from "../../../components/dw-avatar";
import { DW_AVATAR_PRESETS, type DwAvatarPreset } from "../constants";

type DwAvatarPickerProps = {
  preset: DwAvatarPreset;
  onChange: (preset: DwAvatarPreset) => void;
  disabled?: boolean;
  uploading?: boolean;
};

/** Local preset selection only; the containing form uploads on Save. */
export function DwAvatarPicker({
  preset,
  onChange,
  disabled = false,
  uploading = false,
}: DwAvatarPickerProps): JSX.Element {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const gridId = useId();
  const locked = disabled || uploading;
  const handleShuffle = (): void => {
    const others = DW_AVATAR_PRESETS.filter(
      (option) => option.id !== preset.id,
    );
    const next = others[Math.floor(Math.random() * others.length)];
    if (next) {
      onChange(next);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? gridId : undefined}
            aria-label={t({
              id: "digitalWorker.avatarPicker.changeAvatarAria",
              message: "Change avatar",
            })}
            aria-busy={uploading}
            disabled={locked}
            onClick={() => setOpen((prev) => !prev)}
            className="focus-visible:outline-focus-rest relative rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none"
          >
            <DwAvatar agent={{ iconUri: preset.src }} size="2xl" decorative />
            {uploading ? (
              <span
                // eslint-disable-next-line tailwindcss/no-custom-classname -- Semantic Tailwind v4 overlay token; shared has no globals.css for the plugin to resolve it.
                className="bg-overlay-black-50 absolute inset-0 flex items-center justify-center rounded-full"
              >
                <Loader2 className="text-icon-on-inverted size-5 animate-spin" />
              </span>
            ) : null}
          </button>
          <button
            type="button"
            aria-label={t({
              id: "digitalWorker.avatarPicker.shuffleAvatarAria",
              message: "Shuffle avatar",
            })}
            disabled={locked}
            onClick={handleShuffle}
            className="bg-surface-basic text-foreground-primary shadow-s focus-visible:outline-focus-rest absolute -right-0.5 bottom-0 flex size-5 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none"
          >
            <Shuffle className="size-2.5" />
          </button>
        </div>
        <div className="text-foreground-secondary text-sm">
          {uploading ? (
            <Trans id="common.status.uploading">Uploading…</Trans>
          ) : (
            <Trans id="digitalWorker.avatarPicker.hint">
              Click the avatar or Shuffle to generate another one.
            </Trans>
          )}
        </div>
      </div>
      {open ? (
        <DwAvatarGrid
          id={gridId}
          preset={preset}
          onChange={onChange}
          disabled={locked}
        />
      ) : null}
    </div>
  );
}
