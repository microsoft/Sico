import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Field, FieldDescription, FieldLabel, Input } from "@sico/ui";
import { type ReactElement, useEffect } from "react";
import { type Control, Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { RoleSelect } from "./role-select";
import type { Role } from "../../schemas/roles";

const setupBasicInfoSchema = z.object({
  name: z.string().min(1, "Name is required"),
  role: z.string().min(1, "Role is required"),
});
type SetupBasicInfoValues = z.infer<typeof setupBasicInfoSchema>;

// Render helper — a module-scope function (NOT a nested component, so
// `react/no-unstable-nested-components` never fires). RHF `field` is wired
// prop-by-prop, mirroring the project dialogs, because
// `react/jsx-props-no-spreading` forbids `{...field}`.
function renderNameField(control: Control<SetupBasicInfoValues>): ReactElement {
  return (
    <Controller
      name="name"
      control={control}
      render={({ field, fieldState }) => (
        <Field
          className="flex-1"
          data-invalid={fieldState.invalid || undefined}
        >
          <FieldLabel htmlFor="setup-name">
            Original Name
            <span aria-hidden="true">*</span>
          </FieldLabel>
          <Input
            id="setup-name"
            placeholder="e.g. Ryan"
            aria-invalid={fieldState.invalid || undefined}
            name={field.name}
            ref={field.ref}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        </Field>
      )}
    />
  );
}

function renderRoleField(
  control: Control<SetupBasicInfoValues>,
  roleOptions: Role[],
): ReactElement {
  return (
    <Controller
      name="role"
      control={control}
      render={({ field }) => (
        <Field className="flex-1">
          <FieldLabel htmlFor="setup-role">
            Role
            <span aria-hidden="true">*</span>
          </FieldLabel>
          <RoleSelect
            id="setup-role"
            value={field.value}
            options={roleOptions}
            onChange={field.onChange}
          />
          <FieldDescription>Adding new role is not supported.</FieldDescription>
        </Field>
      )}
    />
  );
}

export function SetupBasicInfo({
  name,
  role,
  roleOptions,
  onSave,
}: {
  name: string;
  role: string;
  roleOptions: Role[];
  onSave: (next: { name: string; role: string }) => Promise<void>;
}): ReactElement {
  const form = useForm<SetupBasicInfoValues>({
    resolver: zodResolver(setupBasicInfoSchema),
    defaultValues: { name, role },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty, isSubmitting },
  } = form;

  // Re-seed the baseline when the persisted name/role change (e.g. the agent
  // detail refetches after a save), keyed on the values so an in-progress edit
  // isn't clobbered by a parent re-render that re-creates the props object.
  useEffect(() => {
    reset({ name, role });
  }, [name, role, reset]);

  // Legacy parity (AgentForm): persistence is gated by an explicit Save. The
  // button is disabled — and reads "Saved" — unless both fields are filled, the
  // draft differs from the last saved snapshot, and no save is in flight. This
  // preserves the exact original interaction; the zod schema is the single
  // source of the required-field rule.
  const values = useWatch({ control });
  const saveDisabled =
    !(values.name && values.role) || !isDirty || isSubmitting;

  const submit = handleSubmit(async (submitted) => {
    await onSave(submitted);
    // On success adopt the submitted values as the new clean baseline so the
    // button flips back to "Saved". A rejection leaves the form dirty for retry.
    reset(submitted);
  });

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-foreground-primary text-base font-medium">
          BASIC INFO
        </h2>
        <Button
          type="submit"
          variant="primary"
          size="xs"
          disabled={saveDisabled}
        >
          {saveDisabled ? "Saved" : "Save"}
        </Button>
      </div>
      <div className="bg-surface-basic border-stroke-subtle-card-rest flex flex-col gap-2 rounded-xl border p-6">
        <div className="flex items-start gap-4">
          {renderNameField(control)}
          {renderRoleField(control, roleOptions)}
        </div>
      </div>
    </form>
  );
}
