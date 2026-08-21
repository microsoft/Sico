import { zodResolver } from "@hookform/resolvers/zod";
import type { BaseSyntheticEvent } from "react";
import { useRef } from "react";
import { type Control, useForm } from "react-hook-form";

import { useRegister } from "./use-register";
import type { LoginMode } from "../../../components/shell/login-mode-context";
import type { RegisterNewUserResponse } from "../../../schemas/auth";
import {
  registerFormSchema,
  type RegisterFormValues,
} from "../schemas/register-form";

type UseRegisterFormResult = {
  readonly control: Control<RegisterFormValues>;
  readonly onSubmit: (event?: BaseSyntheticEvent) => Promise<void>;
  readonly isPending: boolean;
  readonly registrationError: string | undefined;
  readonly networkError: string | undefined;
  readonly triggerOnBlurIfFilled: (name: keyof RegisterFormValues) => void;
  readonly clearFormErrors: () => void;
};

export function useRegisterForm(
  mode: LoginMode,
  onSuccess: (data: RegisterNewUserResponse, mode: LoginMode) => void,
): UseRegisterFormResult {
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const submittedModeRef = useRef<LoginMode>(mode);

  const registration = useRegister({
    onSuccess: (data) => onSuccess(data, submittedModeRef.current),
    onRejectedError: () =>
      form.setError("root.registration", {
        message:
          "We couldn't create your account. Check your details and try again.",
      }),
    onNetworkError: () =>
      form.setError("root.network", {
        message:
          "Couldn't reach the server. Please check your connection and try again.",
      }),
  });

  // Clears BOTH root errors (registration + network) — any credential edit
  // signals the user is correcting, so neither form-level error should linger.
  const clearFormErrors = (): void => {
    if (form.formState.errors.root) {
      form.clearErrors("root");
    }
  };

  const triggerOnBlurIfFilled = (name: keyof RegisterFormValues): void => {
    if (form.getValues(name)) {
      void form.trigger(name);
    }
  };

  const onSubmit = form.handleSubmit((values) => {
    submittedModeRef.current = mode;
    registration.mutate(values);
  });

  return {
    control: form.control,
    onSubmit,
    isPending: registration.isPending,
    registrationError: form.formState.errors.root?.registration?.message,
    networkError: form.formState.errors.root?.network?.message,
    triggerOnBlurIfFilled,
    clearFormErrors,
  };
}
