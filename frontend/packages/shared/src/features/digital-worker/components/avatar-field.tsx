import { useLingui } from "@lingui/react/macro";
import { Field, FieldLabel } from "@sico/ui";
import type * as React from "react";

import { DwAvatarPicker } from "./dw-avatar-picker";
import { FIELD_LABEL_CLASS } from "../../../constants/form";
import type { DwAvatarPreset } from "../constants";

export function AvatarField({
  preset,
  onSelectPreset,
  disabled,
  uploading,
}: {
  preset: DwAvatarPreset;
  onSelectPreset: (preset: DwAvatarPreset) => void;
  disabled: boolean;
  uploading: boolean;
}): React.JSX.Element {
  const { t } = useLingui();
  return (
    <Field>
      <FieldLabel className={FIELD_LABEL_CLASS}>
        {t({
          id: "digitalWorker.addDialog.avatarLabel",
          message: "Avatar",
        })}
      </FieldLabel>
      <DwAvatarPicker
        preset={preset}
        onChange={onSelectPreset}
        disabled={disabled}
        uploading={uploading}
      />
    </Field>
  );
}
