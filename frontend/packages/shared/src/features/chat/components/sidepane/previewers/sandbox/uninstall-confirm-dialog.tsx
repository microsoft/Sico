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
import { Loader2 } from "lucide-react";
import { type JSX } from "react";

export type UninstallConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Whether the uninstall targets every device (changes the copy + scope).
  forAllDevices: boolean;
  // Fires on confirm; the dialog does NOT self-close — the consumer closes it
  // once the uninstall mutation settles.
  onConfirm: () => void;
  pending?: boolean;
};

// Uninstall-confirm dialog for the sandbox manage-apps panel. A local dialog
// (not the projects `ConfirmDialog`) because that one's action copy is fixed to
// "Delete"; here the action reads "Uninstall" and the body switches on scope.
export function UninstallConfirmDialog({
  open,
  onOpenChange,
  forAllDevices,
  onConfirm,
  pending = false,
}: UninstallConfirmDialogProps): JSX.Element {
  const title = forAllDevices
    ? "Uninstall this app for all devices?"
    : "Uninstall this app?";
  const body = forAllDevices
    ? "This app will be removed from all devices. This action cannot be undone."
    : "This app will be removed from this device.";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="primary" />}>
            Cancel
          </DialogClose>
          <Button
            variant="destructive-outline"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            {pending ? "Uninstalling…" : "Uninstall"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
