import { useLingui } from "@lingui/react/macro";
import { Field, FieldLabel } from "@sico/ui";
import { Loader2 } from "lucide-react";
import type * as React from "react";

import { ProjectAvatar } from "../../../components/project-avatar";
import { FIELD_LABEL_CLASS } from "../../../constants/form";
import { useImageUpload } from "../../../hooks/use-image-upload";

export type CoverFieldProps = {
  value: string | undefined;
  onChange: (iconUri: string | undefined) => void;
};

/** Square cover picker with EAGER upload: click the tile → local preview +
 * spinner overlay while uploading → the resolved relative `uri` is stored on the
 * form. The upload state machine lives in {@link useImageUpload}. */
export function CoverField({
  value,
  onChange,
}: CoverFieldProps): React.JSX.Element {
  const { t } = useLingui();
  const { inputRef, uploading, preview, onPick } = useImageUpload(onChange);

  let coverLabel = t({
    id: "projects.coverField.upload",
    message: "Upload a cover",
  });
  if (uploading) {
    coverLabel = t({
      id: "projects.coverField.uploading",
      message: "Uploading…",
    });
  } else if (value) {
    coverLabel = t({
      id: "projects.coverField.change",
      message: "Change cover",
    });
  }

  return (
    <Field>
      <FieldLabel className={FIELD_LABEL_CLASS}>
        {t({
          id: "projects.coverField.label",
          message: "Project cover",
        })}
      </FieldLabel>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={t({
            id: "projects.coverField.choose",
            message: "Choose project cover",
          })}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="focus-visible:outline-focus-rest relative rounded-lg transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none"
        >
          <ProjectAvatar
            project={{ iconUrl: value }}
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
        aria-label={t({
          id: "projects.coverField.fileInput",
          message: "Project cover file",
        })}
        onChange={(e) => {
          void onPick(e);
        }}
      />
    </Field>
  );
}
