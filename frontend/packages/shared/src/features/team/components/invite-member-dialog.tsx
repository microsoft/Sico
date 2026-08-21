import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  toast,
} from "@sico/ui";
import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type * as React from "react";
import { type Control, Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { useApiClient } from "../../../services/api-client-context";
import { apiErrorMessage } from "../../../utils/api-error-message";
import { MEMBER_ROLE_LABELS } from "../../rbac";
import { RoleCodeSchema } from "../../rbac/schemas/user-role";
import { findUserByEmail } from "../../rbac/services/user-role";
import { useInviteMemberMutation } from "../hooks/use-invite-member-mutation";

const inviteMemberSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  roleCode: RoleCodeSchema,
});
type InviteMemberValues = z.infer<typeof inviteMemberSchema>;

const INITIAL: InviteMemberValues = {
  email: "",
  roleCode: RoleCodeSchema.enum.project_member,
};

export type InviteMemberDialogProps = {
  projectId: number;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Invite an existing user to the project by email + role (scheme A). Resolves
 * the email to a user via `findUserByEmail`; an unregistered email toasts and
 * aborts, otherwise the role is granted. RHF + zodResolver + `@sico/ui` Field. */
export function InviteMemberDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: InviteMemberDialogProps): React.JSX.Element {
  const apiClient = useApiClient();
  const mutation = useInviteMemberMutation(projectId);
  const [resolving, setResolving] = useState(false);
  const form = useForm<InviteMemberValues>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: INITIAL,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  useEffect(() => {
    if (open) {
      form.reset(INITIAL);
    }
  }, [open, form]);

  const onSubmit = async (values: InviteMemberValues): Promise<void> => {
    setResolving(true);
    try {
      const user = await findUserByEmail(apiClient, values.email);
      if (!user) {
        toast.error("This user isn't registered yet.");
        return;
      }
      mutation.mutate(
        { userId: user.id, roleCode: values.roleCode },
        {
          onSuccess: () => {
            toast.success("Member invited.", { invert: true });
            onOpenChange(false);
          },
          onError: (error) => {
            toast.error(
              apiErrorMessage(error, "We couldn't invite this user."),
            );
          },
        },
      );
    } catch (error) {
      toast.error(apiErrorMessage(error, "We couldn't look up this user."));
    } finally {
      setResolving(false);
    }
  };

  const busy = resolving || mutation.isPending;
  const email = useWatch({ control: form.control, name: "email" });
  const hasEmail = email.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="content" className="w-120">
        <DialogHeader>
          <DialogTitle>Invite to {projectName}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            void form.handleSubmit(onSubmit)(e);
          }}
        >
          <FieldGroup>{renderEmailRow(form.control)}</FieldGroup>
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
              aria-busy={busy}
              disabled={busy || !hasEmail}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Inviting…" : "Invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Email input with the role dropdown pinned inside its right edge (PR313). The
// email + role Controllers share the row; the input reserves right padding so
// text never slides under the dropdown trigger.
function renderEmailRow(
  control: Control<InviteMemberValues>,
): React.JSX.Element {
  return (
    <Controller
      name="email"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel htmlFor="invite-member-email">Email</FieldLabel>
          <div className="relative">
            <Input
              id="invite-member-email"
              type="email"
              placeholder="colleague@company.com"
              aria-invalid={fieldState.invalid ? true : undefined}
              className="pr-28"
              name={field.name}
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
            />
            {renderRoleDropdown(control)}
          </div>
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}

function renderRoleDropdown(
  control: Control<InviteMemberValues>,
): React.JSX.Element {
  return (
    <Controller
      name="roleCode"
      control={control}
      render={({ field }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="link"
                aria-label="Role"
                className="text-foreground-secondary hover:text-foreground-primary absolute top-1/2 right-0 h-auto -translate-y-1/2 gap-1 py-0 pr-3 pl-2 text-xs font-normal no-underline hover:no-underline"
              />
            }
          >
            {MEMBER_ROLE_LABELS[field.value]}
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="!w-32">
            <DropdownMenuRadioGroup
              value={field.value}
              onValueChange={(v) => field.onChange(RoleCodeSchema.parse(v))}
            >
              {RoleCodeSchema.options.map((code) => (
                <DropdownMenuRadioItem key={code} value={code} closeOnClick>
                  {MEMBER_ROLE_LABELS[code]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    />
  );
}
