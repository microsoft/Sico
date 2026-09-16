import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  FieldGroup,
  toast,
} from "@sico/ui";
import { useAtomValue } from "jotai";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import type * as React from "react";

import { userAtom } from "../../../atoms/auth-atom";
import { useAddDwForm } from "../../../hooks/use-add-dw-form";
import { apiErrorMessage } from "../../../utils/api-error-message";
import { AddDwDialogHeader } from "../../digital-worker/components/add-dw-dialog-header";
import {
  ADD_DW_INITIAL_VALUES,
  type AddDwValues,
} from "../../digital-worker/components/add-dw-fields";
import { AvatarField } from "../../digital-worker/components/avatar-field";
import { DwField } from "../../digital-worker/components/dw-field";
import { NameField } from "../../digital-worker/components/name-field";
import { useCreateAgentInstanceMutation } from "../../digital-worker/hooks/use-create-agent-mutation";
import { deriveState } from "../../digital-worker/utils/load-state";
import { useAgentInfosQuery } from "../../studio/hooks/use-agent-infos-query";
import { type SingleAgentCard } from "../../studio/schemas/single-agent-card";
import { PLATFORM_AGENT_INFOS_INTENT } from "../../studio/services/single-agents";

export type InviteDwDialogProps = {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Imperative toast copy (module scope, non-React) resolved with `i18n._()` at
// toast time, so it follows the active locale without a component hook.
const MUST_SIGN_IN_COPY = msg({
  id: "team.inviteDw.error.mustSignIn",
  message: "You must be signed in to add a digital worker.",
});
const ADDED_COPY = msg({
  id: "team.inviteDw.success.added",
  message: "Digital Worker added.",
});
const ADD_FAILED_COPY = msg({
  id: "team.inviteDw.error.addFailed",
  message: "We couldn't add the digital worker.",
});

async function submitInviteDw({
  values,
  userEmail,
  templates,
  projectId,
  mutateAsync,
  onOpenChange,
  signal,
}: {
  values: AddDwValues;
  userEmail: string | undefined;
  templates: SingleAgentCard[];
  projectId: number;
  mutateAsync: ReturnType<typeof useCreateAgentInstanceMutation>["mutateAsync"];
  onOpenChange: (open: boolean) => void;
  signal: AbortSignal;
}): Promise<void> {
  if (!userEmail) {
    toast.error(i18n._(MUST_SIGN_IN_COPY));
    return;
  }
  const role = templates.find(
    (template) => template.agentId === values.agentId,
  )?.role;
  try {
    await mutateAsync({
      agentId: values.agentId,
      name: values.name,
      role,
      iconUri: values.iconUri,
      employerUsername: userEmail,
      projectId,
    });
    if (!signal.aborted) {
      toast.success(i18n._(ADDED_COPY), { invert: true });
      onOpenChange(false);
    }
  } catch (error) {
    if (!signal.aborted) {
      toast.error(apiErrorMessage(error, i18n._(ADD_FAILED_COPY)));
    }
  }
}

/** Add a digital worker to THIS project (module3). Reuses the Add DW field
 * renderers but drops the project select — `projectId` comes from the route and
 * is seeded into the form (kept for renderer type-compat) then injected into the
 * create call. RHF + zodResolver + `@sico/ui` Field. */
export function InviteDwDialog({
  projectId,
  open,
  onOpenChange,
}: InviteDwDialogProps): React.JSX.Element {
  const { t } = useLingui();
  const user = useAtomValue(userAtom);
  const templatesQuery = useAgentInfosQuery(PLATFORM_AGENT_INFOS_INTENT);
  const templates = templatesQuery.data ?? [];
  const templatesState = deriveState(
    templatesQuery.isPending,
    templatesQuery.isError,
    templates.length,
  );
  // Seed projectId from the route so the select field can be omitted while the
  // shared renderers (typed to AddDwValues) still receive a compatible form.
  const initial: AddDwValues = useMemo(
    () => ({ ...ADD_DW_INITIAL_VALUES, projectId: String(projectId) }),
    [projectId],
  );
  const mutation = useCreateAgentInstanceMutation();
  const {
    form,
    preset,
    onSelectPreset,
    isSaving,
    isUploading,
    handleOpenChange,
    handleSubmit,
  } = useAddDwForm({
    open,
    isPending: mutation.isPending,
    onOpenChange,
    initialValues: initial,
    onSubmit: (values, signal) =>
      submitInviteDw({
        values,
        userEmail: user?.email,
        templates,
        projectId,
        mutateAsync: mutation.mutateAsync,
        onOpenChange,
        signal,
      }),
  });

  const handlePick = (card: SingleAgentCard | undefined): void => {
    if (card && !form.getFieldState("name").isDirty) {
      form.setValue("name", card.name);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent variant="content" className="w-150">
        <AddDwDialogHeader />
        <form noValidate onSubmit={handleSubmit}>
          <FieldGroup>
            <DwField
              control={form.control}
              templates={templates}
              state={templatesState}
              onPick={handlePick}
            />
            <NameField control={form.control} />
            <AvatarField
              preset={preset}
              onSelectPreset={onSelectPreset}
              disabled={isSaving}
              uploading={isUploading}
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="subtle"
              onClick={() => handleOpenChange(false)}
            >
              {t({ id: "common.action.cancel", message: "Cancel" })}
            </Button>
            <Button
              type="submit"
              variant="primary"
              aria-busy={isSaving}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="animate-spin" /> : null}
              {isSaving
                ? t({ id: "common.status.saving", message: "Saving…" })
                : t({ id: "common.action.save", message: "Save" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
