import { toast } from "@sico/ui";
import { useState } from "react";

import { apiErrorMessage } from "../../../utils/api-error-message";
import { useDismissAgentMutation } from "../../digital-worker/hooks/use-dismiss-agent-mutation";
import { type Agent } from "../../digital-worker/schemas/agent";

export type DismissAgent = {
  /** Confirm-dialog visibility (opened from the Dismiss menu item). */
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  /** Fires the dismiss mutation; toasts + closes the dialog on success. */
  onDismiss: () => void;
  isPending: boolean;
};

// The dismiss-a-worker flow for the DW table's `···` action cell: owns the
// confirm-dialog state + the mutation, so the cell component stays presentational
// and the table file holds only render helpers (no per-row hook logic inline).
export function useDismissAgent(agent: Agent): DismissAgent {
  const dismiss = useDismissAgentMutation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const onDismiss = (): void => {
    dismiss.mutate(
      { id: agent.id },
      {
        onSuccess: () => {
          toast.success("Digital Worker dismissed.", { invert: true });
          setConfirmOpen(false);
        },
        onError: (error) =>
          toast.error(
            apiErrorMessage(error, "We couldn't dismiss this worker."),
          ),
      },
    );
  };
  return {
    confirmOpen,
    setConfirmOpen,
    onDismiss,
    isPending: dismiss.isPending,
  };
}
