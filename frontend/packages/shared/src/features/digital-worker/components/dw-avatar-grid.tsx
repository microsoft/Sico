import { useLingui } from "@lingui/react/macro";
import { cn } from "@sico/ui/lib/utils.ts";
import { type JSX, useEffect, useRef } from "react";

import { DwAvatar } from "../../../components/dw-avatar";
import { DW_AVATAR_PRESETS, type DwAvatarPreset } from "../constants";

export function DwAvatarGrid({
  preset,
  onChange,
  disabled,
  id,
}: {
  preset: DwAvatarPreset;
  onChange: (preset: DwAvatarPreset) => void;
  disabled: boolean;
  id: string;
}): JSX.Element {
  const { t } = useLingui();
  const gridRef = useRef<HTMLDivElement>(null);

  // Reveal the entire grid above the containing dialog's footer.
  useEffect(() => {
    gridRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, []);

  return (
    <div
      id={id}
      ref={gridRef}
      role="radiogroup"
      aria-label={t({
        id: "digitalWorker.avatarPicker.groupAria",
        message: "Avatar",
      })}
      className="flex flex-wrap gap-2 p-1"
    >
      {DW_AVATAR_PRESETS.map((option, i) => {
        const index = i + 1;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={preset.id === option.id}
            aria-label={t({
              id: "digitalWorker.avatarPicker.avatarAria",
              message: `Avatar ${index}`,
            })}
            disabled={disabled}
            onClick={() => onChange(option)}
            className={cn(
              "focus-visible:outline-focus-rest rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none",
              preset.id === option.id && "ring-focus-rest ring-2 ring-offset-2",
            )}
          >
            <DwAvatar agent={{ iconUri: option.src }} size="lg" decorative />
          </button>
        );
      })}
    </div>
  );
}
