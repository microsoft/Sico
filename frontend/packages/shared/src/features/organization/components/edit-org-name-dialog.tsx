import { zodResolver } from "@hookform/resolvers/zod";
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldGroup,
  toast,
} from "@sico/ui";
import { useEffect } from "react";
import type * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { OrganizationAvatarField } from "./organization-avatar-field";
import { OrganizationNameField } from "./organization-name-field";
import { useImageUpload } from "../../../hooks/use-image-upload";
import { useUpdateOrganization } from "../hooks/use-update-organization";

const NAME_REQUIRED = msg({
  id: "organization.editName.validation.required",
  message: "Organization name is required",
});
const EDIT_ORGANIZATION_TITLE = msg({
  id: "organization.edit.title",
  message: "Edit Organization",
});

const editOrgNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: () => i18n._(NAME_REQUIRED) }),
  iconUri: z.string().optional(),
});
type EditOrgNameValues = z.infer<typeof editOrgNameSchema>;

export type EditOrgNameDialogProps = {
  organizationId: number;
  currentName: string;
  currentIconUrl?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditOrgNameDialog({
  organizationId,
  currentName,
  currentIconUrl,
  open,
  onOpenChange,
}: EditOrgNameDialogProps): React.JSX.Element {
  const { t } = useLingui();
  const update = useUpdateOrganization(organizationId);
  const form = useForm<EditOrgNameValues>({
    resolver: zodResolver(editOrgNameSchema),
    defaultValues: { name: currentName, iconUri: undefined },
  });
  const name = useWatch({ control: form.control, name: "name" });
  const upload = useImageUpload((uri) => form.setValue("iconUri", uri));
  const { reset } = upload;
  useEffect(() => {
    reset();
    form.reset({ name: currentName, iconUri: undefined });
  }, [open, organizationId, currentName, currentIconUrl, form, reset]);

  const onSubmit = (values: EditOrgNameValues): void => {
    if (upload.uploading || update.isPending) {
      return;
    }
    update.mutate(values, {
      onSuccess: () => {
        toast.success(
          t({
            id: "organization.edit.success",
            message: "Organization updated.",
          }),
          { invert: true },
        );
        onOpenChange(false);
      },
      onError: () =>
        toast.error(
          t({
            id: "organization.edit.failed",
            message: "Couldn't update this organization.",
          }),
        ),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="content" className="w-130">
        <DialogHeader>
          <DialogTitle>{t(EDIT_ORGANIZATION_TITLE)}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <OrganizationNameField
              control={form.control}
              disabled={update.isPending}
            />
            <OrganizationAvatarField
              name={name}
              currentIconUrl={currentIconUrl}
              previewSrc={upload.preview}
              inputRef={upload.inputRef}
              onPick={upload.onPick}
              uploading={upload.uploading}
              disabled={update.isPending}
            />
          </FieldGroup>
          <DialogFooter className="mt-3">
            <Button
              type="button"
              variant="subtle"
              onClick={() => onOpenChange(false)}
            >
              {t({ id: "common.action.cancel", message: "Cancel" })}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={upload.uploading || update.isPending}
            >
              {t({ id: "common.action.save", message: "Save" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
