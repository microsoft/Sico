import { toast } from "@sico/ui";

import { useCreateAgentInstanceMutation } from "./use-create-agent-mutation";
import { apiErrorMessage } from "../../../utils/api-error-message";
import { type SingleAgentCard } from "../../studio/schemas/single-agent-card";
import { type AddDwValues } from "../components/add-dw-fields";

type UseAddDwSubmit = {
  onSubmit: (values: AddDwValues) => void;
  isPending: boolean;
};

/**
 * Encapsulates the Add DW create flow: validates the signed-in user, resolves
 * the role from the picked template, fires the create mutation, and toasts
 * success/error (closing the dialog on success). Returns the RHF submit handler
 * plus the pending flag for the footer button.
 */
export function useAddDwSubmit(
  email: string | undefined,
  templates: SingleAgentCard[],
  onClose: () => void,
): UseAddDwSubmit {
  const mutation = useCreateAgentInstanceMutation();

  const onSubmit = (values: AddDwValues): void => {
    if (!email) {
      toast.error("You must be signed in to add a digital worker.");
      return;
    }
    const role = templates.find((t) => t.agentId === values.agentId)?.role;
    mutation.mutate(
      {
        agentId: values.agentId,
        name: values.name,
        role,
        iconUri: values.iconUri,
        employerUsername: email,
        projectId: Number(values.projectId),
      },
      {
        onSuccess: () => {
          toast.success("Digital worker added.", { invert: true });
          onClose();
        },
        onError: (error) => {
          toast.error(
            apiErrorMessage(error, "We couldn't add the digital worker."),
          );
        },
      },
    );
  };

  return { onSubmit, isPending: mutation.isPending };
}
