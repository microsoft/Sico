import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { toast } from "@sico/ui";

import { useCreateAgentInstanceMutation } from "./use-create-agent-mutation";
import { apiErrorMessage } from "../../../utils/api-error-message";
import { type SingleAgentCard } from "../../studio/schemas/single-agent-card";
import { type AddDwValues } from "../components/add-dw-fields";

type UseAddDwSubmit = {
  onSubmit: (values: AddDwValues, signal: AbortSignal) => Promise<void>;
  isPending: boolean;
};

const SIGN_IN_REQUIRED = msg({
  id: "digitalWorker.addDialog.signInRequired",
  message: "You must be signed in to add a digital worker.",
});
const ADDED = msg({
  id: "digitalWorker.addDialog.added",
  message: "Digital worker added.",
});
const ADD_FAILED = msg({
  id: "digitalWorker.addDialog.addFailed",
  message: "We couldn't add the digital worker.",
});

export function useAddDwSubmit(
  email: string | undefined,
  templates: SingleAgentCard[],
  onClose: () => void,
): UseAddDwSubmit {
  const mutation = useCreateAgentInstanceMutation();
  const onSubmit = async (
    values: AddDwValues,
    signal: AbortSignal,
  ): Promise<void> => {
    if (!email) {
      toast.error(i18n._(SIGN_IN_REQUIRED));
      return;
    }
    const role = templates.find(
      (template) => template.agentId === values.agentId,
    )?.role;
    try {
      await mutation.mutateAsync({
        agentId: values.agentId,
        name: values.name,
        role,
        iconUri: values.iconUri,
        employerUsername: email,
        projectId: Number(values.projectId),
      });
      // Closing does not undo creation, but its result must not close a new dialog.
      if (!signal.aborted) {
        toast.success(i18n._(ADDED), { invert: true });
        onClose();
      }
    } catch (error) {
      if (!signal.aborted) {
        toast.error(apiErrorMessage(error, i18n._(ADD_FAILED)));
      }
    }
  };
  return { onSubmit, isPending: mutation.isPending };
}
