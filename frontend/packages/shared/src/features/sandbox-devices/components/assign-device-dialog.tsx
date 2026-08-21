import { zodResolver } from "@hookform/resolvers/zod";
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
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import type * as React from "react";
import { useForm } from "react-hook-form";

import {
  ASSIGN_DEVICE_INITIAL_VALUES,
  assignDeviceSchema,
  type AssignDeviceValues,
  renderDwField,
} from "./assign-device-fields";
import { apiErrorMessage } from "../../../utils/api-error-message";
import {
  useAgentsQuery,
  useDedupedAgents,
} from "../../digital-worker/hooks/use-agents-query";
import { useAssignDeviceMutation } from "../hooks/use-assign-device-mutation";
import { type Device } from "../schemas/device";

export type AssignDeviceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  // The device being assigned; null when the dialog is closed.
  device: Device | null;
};

/** Controlled dialog binding a sandbox device to a Digital Worker instance.
 * RHF + zodResolver + `@sico/ui` `Field` primitives (mirrors CreateProjectDialog);
 * one Select sourced from the project-scoped agents list (so only THIS project's
 * DWs are assignable — the sandbox pool is org→project bound). */
export function AssignDeviceDialog({
  open,
  onOpenChange,
  projectId,
  device,
}: AssignDeviceDialogProps): React.JSX.Element {
  const form = useForm<AssignDeviceValues>({
    resolver: zodResolver(assignDeviceSchema),
    defaultValues: ASSIGN_DEVICE_INITIAL_VALUES,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  // The assignable DWs are this project's agents (backend-filtered by projectId).
  const agentsQuery = useAgentsQuery({ projectId });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = agentsQuery;
  // Drain every page so a project with >50 workers doesn't drop the tail from
  // the dropdown (mirrors MembersDwTab).
  useEffect(() => {
    if (open && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [open, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const agents = useDedupedAgents(agentsQuery.data?.pages);
  const mutation = useAssignDeviceMutation(projectId);

  useEffect(() => {
    if (open) {
      form.reset(ASSIGN_DEVICE_INITIAL_VALUES);
    }
  }, [open, form]);

  // Dialog operations surface load failures as a toast (not inline) — the DW
  // dropdown just can't be populated, so tell the user why on open.
  const agentsError = open && agentsQuery.isError;
  useEffect(() => {
    if (agentsError) {
      toast.error(
        "We couldn't load digital workers. Try reopening the dialog.",
      );
    }
  }, [agentsError]);

  const onSubmit = (values: AssignDeviceValues): void => {
    if (!device) {
      return;
    }
    mutation.mutate(
      { instanceId: values.instanceId, sandboxId: device.sandboxId },
      {
        onSuccess: () => {
          toast.success("Device assigned.", { invert: true });
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(apiErrorMessage(error, "We couldn't assign the device."));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="content" className="w-120">
        <DialogHeader>
          <DialogTitle>Assign device</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {renderDwField(
              form.control,
              agents,
              agentsQuery.isPending || agentsQuery.isError,
              agentsQuery.isPending,
            )}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="subtle"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              aria-busy={mutation.isPending}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
              {mutation.isPending ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
