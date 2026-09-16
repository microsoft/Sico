import { useLingui } from "@lingui/react/macro";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Field,
  FieldLabel,
} from "@sico/ui";
import { Loader2 } from "lucide-react";
import type { ChangeEvent, JSX, RefObject } from "react";

import { FIELD_LABEL_CLASS } from "../../../constants/form";
import { safeIconUri } from "../../../utils/safe-icon-uri";

export type OrganizationAvatarFieldProps = {
  name: string;
  currentIconUrl?: string | null;
  previewSrc?: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  uploading: boolean;
  disabled: boolean;
};

export function OrganizationAvatarField({
  name,
  currentIconUrl,
  previewSrc,
  inputRef,
  onPick,
  uploading,
  disabled,
}: OrganizationAvatarFieldProps): JSX.Element {
  const { t } = useLingui();
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const src = previewSrc ?? safeIconUri(currentIconUrl ?? undefined);
  return (
    <Field data-disabled={disabled ? true : undefined}>
      <FieldLabel className={FIELD_LABEL_CLASS}>
        {t({
          id: "organization.editName.avatar.label",
          message: "Organization avatar",
        })}
      </FieldLabel>
      <button
        type="button"
        disabled={disabled}
        aria-busy={uploading}
        aria-label={t({
          id: "organization.editName.avatar.choose",
          message: "Choose organization avatar",
        })}
        onClick={() => inputRef.current?.click()}
        className="focus-visible:outline-focus-rest flex w-fit items-center gap-3 rounded-lg transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Avatar
          key={src ?? "initial"}
          size="2xl"
          className="rounded-lg after:rounded-lg"
          aria-hidden="true"
        >
          {src ? (
            <AvatarImage
              src={src}
              alt=""
              className="rounded-lg"
              referrerPolicy="no-referrer"
              data-testid="organization-avatar-preview"
            />
          ) : null}
          <AvatarFallback
            data-testid="organization-avatar-initial"
            className="bg-surface-sunken text-foreground-primary rounded-lg text-base font-medium"
          >
            {initial}
          </AvatarFallback>
          {uploading ? (
            <span className="bg-surface-basic/80 absolute inset-0 flex items-center justify-center rounded-lg">
              <Loader2 className="size-4 animate-spin" />
            </span>
          ) : null}
        </Avatar>
        <span className="text-foreground-primary text-sm font-medium">
          {t({
            id: "organization.editName.avatar.change",
            message: "Change avatar",
          })}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        disabled={disabled}
        accept="image/*"
        aria-label={t({
          id: "organization.editName.avatar.fileInput",
          message: "Organization avatar file",
        })}
        onChange={onPick}
      />
    </Field>
  );
}
