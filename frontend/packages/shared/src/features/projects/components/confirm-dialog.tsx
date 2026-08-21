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
import type * as React from "react";
import { memo } from "react";

export type ConfirmDialogProps = {
  /** Visibility is consumer-owned — passed straight to the `<Dialog>` root. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heading copy (e.g. "Delete Knowledge") → `DialogTitle`. */
  title: string;
  /** Supporting copy → `DialogDescription`. */
  body: string;
  /** Fires when the user confirms; the dialog does NOT self-close. */
  onConfirm: () => void;
  /** While true the destructive action shows a spinner and disables. */
  pending?: boolean;
  /** Confirm-button verb (default "Delete"). E.g. "Dismiss", "Remove". */
  confirmLabel?: string;
  /** Confirm-button label while pending (default "Deleting…"). */
  pendingLabel?: string;
};

/**
 * Reusable destructive-confirm dialog (design.md §5 `confirm.delete`) — the
 * single confirm reused by asset delete, member remove, and DW dismiss. Built on
 * the `@sico/ui` `Dialog` primitives; `title`/`body` and the confirm verb are
 * supplied by the consumer rather than hardcoded.
 *
 * Visibility is fully consumer-controlled: `open`/`onOpenChange` pass straight
 * to the `<Dialog>` root, Cancel closes via `DialogClose`, and `onConfirm`
 * only signals intent — the consumer closes the dialog on mutation success.
 */
function ConfirmDialogImpl({
  open,
  onOpenChange,
  title,
  body,
  onConfirm,
  pending = false,
  confirmLabel = "Delete",
  pendingLabel = "Deleting…",
}: ConfirmDialogProps): React.JSX.Element {
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
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const ConfirmDialog = memo(ConfirmDialogImpl);
