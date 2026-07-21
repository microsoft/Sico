// `<OperatorAdder>` — inline operator-add control for `<EditProjectDialog>`.
// Lives in its own file (not inline in the dialog) so it stays a real,
// keyable component without tripping `react/no-multi-comp`; the dialog remounts
// it via `key` to reset its open/draft state symmetrically on every open/close.
import { Button, Field, FieldLabel, Input } from "@sico/ui";
import { Check, X } from "lucide-react";
import { useState } from "react";
import type * as React from "react";

export type OperatorAdderProps = {
  existingOperators: string[];
  pending: boolean;
  onAdd: (operators: string[]) => void;
};

/**
 * Self-contained "add operators" control. Owns its own open/draft state and
 * computes the deduped Set union internally, so the parent only receives the
 * final `operatorAdmins` list to mutate. Reset is handled by remount (the
 * parent keys it on dialog open), never by an effect.
 */
export function OperatorAdder({
  existingOperators,
  pending,
  onAdd,
}: OperatorAdderProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const confirm = (): void => {
    // OQ-B: operator identifier (username vs email) unresolved — entries passed verbatim, no email validation.
    const parsed = text
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (parsed.length > 0) {
      onAdd(Array.from(new Set([...existingOperators, ...parsed])));
    }
    setText("");
    setOpen(false);
  };

  const cancel = (): void => {
    setText("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Field>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => setOpen(true)}
        >
          Add operator
        </Button>
      </Field>
    );
  }

  return (
    <Field>
      <FieldLabel htmlFor="edit-project-operators" className="text-base">
        Operators
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id="edit-project-operators"
          placeholder="Add comma separated emails"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !pending) {
              event.preventDefault();
              confirm();
            }
          }}
        />
        <Button
          type="button"
          variant="subtle"
          size="icon-sm"
          aria-label="Confirm operators"
          disabled={pending}
          onClick={confirm}
        >
          <Check />
        </Button>
        <Button
          type="button"
          variant="subtle"
          size="icon-sm"
          aria-label="Cancel"
          onClick={cancel}
        >
          <X />
        </Button>
      </div>
    </Field>
  );
}
