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

/* eslint-disable max-lines, max-lines-per-function, react/no-multi-comp -- co-located field helpers + the CoverField sub-component keep the Create Project form in one readable unit; splitting each render helper into its own file adds indirection without value, and CoverField's upload state machine is cohesive. */
import { Field, FieldError, FieldLabel, Input, toast } from "@sico/ui";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { type Control, Controller } from "react-hook-form";
import { z } from "zod";

import { CharCountTextarea } from "../../../components/char-count-textarea";
import { ProjectAvatar } from "../../../components/project-avatar";
import { useApiClient } from "../../../services/api-client-context";
import { logger } from "../../../utils/logger";
import { uploadAttachment } from "../../chat/services/upload";

const MAX_NAME_LENGTH = 20;
export const MAX_DESCRIPTION_LENGTH = 200;

// Backend caps name at ≤100. Description is capped at 200 characters
// (client-only, matching the design). A character cap (not word count) is used
// so the limit is meaningful for CJK text, which has no inter-word spaces.
// `iconUri` holds the eagerly-uploaded cover's relative `uri`.
export const createProjectSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(MAX_NAME_LENGTH, "Name is too long"),
  description: z
    .string()
    .max(
      MAX_DESCRIPTION_LENGTH,
      `Description must be ${String(MAX_DESCRIPTION_LENGTH)} characters or fewer`,
    ),
  iconUri: z.string().optional(),
});
export type CreateProjectValues = z.infer<typeof createProjectSchema>;

export const CREATE_PROJECT_INITIAL_VALUES: CreateProjectValues = {
  name: "",
  description: "",
  iconUri: undefined,
};

const UPPER_LABEL =
  "text-foreground-secondary text-xs font-semibold tracking-wider uppercase";

export function renderNameField(
  control: Control<CreateProjectValues>,
): React.JSX.Element {
  return (
    <Controller
      name="name"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel htmlFor="create-project-name" className={UPPER_LABEL}>
            Name
          </FieldLabel>
          <Input
            id="create-project-name"
            placeholder="e.g. Aurora launch"
            maxLength={MAX_NAME_LENGTH}
            aria-invalid={fieldState.invalid ? true : undefined}
            name={field.name}
            ref={field.ref}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}

export function renderDescriptionField(
  control: Control<CreateProjectValues>,
): React.JSX.Element {
  return (
    <Controller
      name="description"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel
            htmlFor="create-project-description"
            className={UPPER_LABEL}
          >
            Description
          </FieldLabel>
          <CharCountTextarea
            id="create-project-description"
            placeholder="What is this project trying to do? Who is it for?"
            ariaInvalid={fieldState.invalid ? true : undefined}
            max={MAX_DESCRIPTION_LENGTH}
            // Fixed height — override the base `field-sizing-content` so the
            // dialog layout stays stable; overflow scrolls internally.
            className="[field-sizing:fixed] h-30 resize-none"
            name={field.name}
            ref={field.ref}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}

// Square cover picker with EAGER upload: click the tile → local objectURL
// preview + Loader2 overlay while uploading → the resolved relative `uri` is
// stored on the form. A monotonic pick id keeps only the latest pick's result,
// and an AbortController cancels a superseded/unmounted upload.
export function CoverField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (iconUri: string | undefined) => void;
}): React.JSX.Element {
  const apiClient = useApiClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const pickIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [preview, setPreview] = useState<string | undefined>();

  // Revoke the previous objectURL when it changes, and the last one on unmount.
  useEffect(
    () => () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    },
    [preview],
  );

  // Abort an in-flight upload ONLY on unmount. This must NOT depend on
  // `preview`: onPick sets the preview right before awaiting the upload, so a
  // `[preview]` cleanup would fire mid-upload and abort the request we just
  // started — the bytes reach the server (200) but axios discards the response
  // as canceled, surfacing as a spurious "upload failed".
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const onPick = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    if (!file) {
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    pickIdRef.current += 1;
    const pickId = pickIdRef.current;
    const objectUrl = URL.createObjectURL(file);
    setPreview((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return objectUrl;
    });
    setUploading(true);
    try {
      const uploaded = await uploadAttachment(
        apiClient,
        file,
        controller.signal,
      );
      if (pickId !== pickIdRef.current) {
        return; // superseded by a newer pick — don't touch state
      }
      onChange(uploaded.uri);
    } catch (error) {
      // An abort — unmount cleanup or a superseded pick — is not a failure:
      // bail without touching state or toasting. `signal.aborted` covers the
      // unmount case (where pickId still matches), the id check the supersede
      // case. Without this, closing the dialog mid-upload flashes a false
      // "upload failed" toast and sets state on an unmounting component.
      if (controller.signal.aborted || pickId !== pickIdRef.current) {
        return;
      }
      logger.error("cover upload failed", { error });
      onChange(undefined);
      setPreview((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return undefined;
      });
      toast.error("We couldn't upload the cover. Try again.");
    } finally {
      if (pickId === pickIdRef.current) {
        setUploading(false);
      }
    }
  };

  let coverLabel = "Upload a cover";
  if (uploading) {
    coverLabel = "Uploading…";
  } else if (value) {
    coverLabel = "Change cover";
  }

  return (
    <Field>
      <FieldLabel className={UPPER_LABEL}>Project cover</FieldLabel>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Choose project cover"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="focus-visible:outline-focus-rest relative rounded-lg transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none"
        >
          <ProjectAvatar
            project={{}}
            previewSrc={preview}
            size="2xl"
            decorative
          />
          {uploading ? (
            <span
              // eslint-disable-next-line tailwindcss/no-custom-classname -- `bg-overlay-black-50` is a valid Tailwind v4 @theme token; unresolvable here because @sico/shared has no globals.css on the plugin's cssFiles path (same escape hatch as image-tile.tsx).
              className="bg-overlay-black-50 absolute inset-0 flex items-center justify-center rounded-lg"
            >
              <Loader2 className="text-icon-on-inverted size-5 animate-spin" />
            </span>
          ) : null}
        </button>
        <div className="text-foreground-secondary flex flex-col gap-1 text-sm">
          <span className="text-foreground-primary font-medium">
            {coverLabel}
          </span>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept="image/*"
        aria-label="Project cover file"
        onChange={(e) => {
          void onPick(e);
        }}
      />
    </Field>
  );
}
