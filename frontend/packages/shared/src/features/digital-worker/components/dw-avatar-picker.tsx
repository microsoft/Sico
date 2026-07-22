/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { cn } from "@sico/ui/lib/utils.ts";
import { Shuffle } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";

import { DwAvatar } from "../../../components/dw-avatar";
import { DW_AVATAR_PRESETS, dwAvatarUrl } from "../constants";

type DwAvatarPickerProps = {
  value: string;
  onChange: (url: string) => void;
};

/**
 * Inline avatar picker (design: Figma "Avatar Selection Grid"). Clicking the
 * current avatar reveals the preset grid below (dialog grows) instead of
 * stacking a popover; a shuffle button picks a random preset. Presets are the
 * pre-uploaded CDN URLs in `DW_AVATAR_PRESETS`, so a pick is a ready `iconUri`.
 */
export function DwAvatarPicker({
  value,
  onChange,
}: DwAvatarPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const handleShuffle = (): void => {
    // Exclude the current avatar so shuffle never visibly no-ops.
    const others = DW_AVATAR_PRESETS.filter((url) => url !== value);
    const pool = others.length > 0 ? others : DW_AVATAR_PRESETS;
    const next =
      pool[Math.floor(Math.random() * pool.length)] ?? DW_AVATAR_PRESETS[0];
    onChange(next);
  };

  // On open, pull the revealed grid into view — bottom-aligned so the whole
  // grid sits above the dialog footer; the dialog's scroll region does the
  // actual scrolling.
  useEffect(() => {
    if (!open) {
      return;
    }
    gridRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [open]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            type="button"
            aria-expanded={open}
            aria-label="Change avatar"
            onClick={() => setOpen((prev) => !prev)}
            className="focus-visible:outline-focus-rest rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <DwAvatar
              agent={{ iconUri: dwAvatarUrl(value) }}
              size="2xl"
              decorative
            />
          </button>
          <button
            type="button"
            aria-label="Shuffle avatar"
            onClick={handleShuffle}
            className="bg-surface-basic text-foreground-primary shadow-s focus-visible:outline-focus-rest absolute -right-0.5 bottom-0 flex size-5 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Shuffle className="size-2.5" />
          </button>
        </div>
        <div className="text-foreground-secondary text-sm">
          Click the avatar or Shuffle to generate another one.
        </div>
      </div>
      {open ? (
        <div
          ref={gridRef}
          role="radiogroup"
          aria-label="Avatar"
          className="flex flex-wrap gap-2 p-1"
        >
          {DW_AVATAR_PRESETS.map((url, i) => {
            const selected = value === url;
            return (
              <button
                key={url}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`Avatar ${String(i + 1)}`}
                onClick={() => onChange(url)}
                className={cn(
                  "focus-visible:outline-focus-rest rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2",
                  selected && "ring-focus-rest ring-2 ring-offset-2",
                )}
              >
                <DwAvatar
                  agent={{ iconUri: dwAvatarUrl(url) }}
                  size="lg"
                  decorative
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
