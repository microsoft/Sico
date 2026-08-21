import {
  Field,
  FieldError,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sico/ui";
import type * as React from "react";
import { type Control, Controller } from "react-hook-form";
import { z } from "zod";

import { FIELD_LABEL_CLASS } from "../../../constants/form";
import { type Agent } from "../../digital-worker/schemas/agent";

// Scheme A — bind a device to a Digital Worker instance only (no operator
// cascade). The single required field is the instance id (as a string, since a
// `Select` yields strings).
export const assignDeviceSchema = z.object({
  instanceId: z.string().min(1, "Pick a digital worker"),
});
export type AssignDeviceValues = z.infer<typeof assignDeviceSchema>;

export const ASSIGN_DEVICE_INITIAL_VALUES: AssignDeviceValues = {
  instanceId: "",
};

export function renderDwField(
  control: Control<AssignDeviceValues>,
  agents: Agent[],
  disabled: boolean,
  isPending: boolean,
): React.JSX.Element {
  // Load failure is surfaced by the dialog as a toast; the placeholder only
  // distinguishes loading / empty / ready here.
  let placeholder = "Select a digital worker…";
  if (isPending) {
    placeholder = "Loading digital workers…";
  } else if (agents.length === 0) {
    placeholder = "No digital workers available";
  }
  return (
    <Controller
      name="instanceId"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel htmlFor="assign-device-dw" className={FIELD_LABEL_CLASS}>
            Digital Worker
          </FieldLabel>
          <Select
            items={agents.map((agent) => ({
              value: String(agent.id),
              label: agent.name,
            }))}
            value={field.value || null}
            onValueChange={(next) => field.onChange(next ?? "")}
            disabled={disabled}
          >
            <SelectTrigger id="assign-device-dw" className="w-full">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {agents.map((agent) => (
                <SelectItem
                  key={agent.id}
                  value={String(agent.id)}
                  label={agent.name}
                >
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}
