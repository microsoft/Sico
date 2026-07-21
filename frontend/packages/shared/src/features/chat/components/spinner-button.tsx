import { Button } from "@sico/ui";
import { Loader2 } from "lucide-react";
import { type JSX } from "react";

type Props = {
  readonly label: string;
  readonly onClick: () => void;
};

// The ↻ spinner send-area button — shared by the pending (↻, stoppable) and
// submitting (create in flight, non-stoppable) states, which are visually
// identical and differ only in `label` + `onClick`.
export function SpinnerButton({ label, onClick }: Props): JSX.Element {
  return (
    <Button
      type="button"
      size="icon"
      className="rounded-full"
      aria-label={label}
      onClick={onClick}
    >
      <Loader2 className="animate-spin" />
    </Button>
  );
}
