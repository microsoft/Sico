import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sico/ui";
import type { ReactElement } from "react";

// Mirrors the legacy DeployDialog: confirm before deploying a single agent to
// "My Digital Workers". `pending` drives the confirm button's label and locks
// both buttons while the deploy mutation is in flight.
export function DeployDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deploy Digital Worker</DialogTitle>
          <DialogDescription>
            Deploy this digital worker to My Digital Workers?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose
            render={<Button variant="secondary" disabled={pending} />}
          >
            Cancel
          </DialogClose>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? "Deploying…" : "Deploy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
