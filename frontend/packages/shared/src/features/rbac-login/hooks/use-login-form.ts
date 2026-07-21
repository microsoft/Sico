import { zodResolver } from "@hookform/resolvers/zod";
import type { BaseSyntheticEvent } from "react";
import { useRef } from "react";
import { type Control, useForm } from "react-hook-form";

import { useLogin } from "./use-login";
import type { LoginMode } from "../../../components/shell/login-mode-context";
import type { LoginResponse } from "../../../schemas/auth";
import { useSicoConfig } from "../../../services/sico-config-context";
import { loginFormSchema, type LoginFormValues } from "../schemas/login-form";

type UseLoginFormResult = {
  readonly control: Control<LoginFormValues>;
  readonly onSubmit: (e?: BaseSyntheticEvent) => Promise<void>;
  readonly isPending: boolean;
  readonly credentialsError: string | undefined;
  readonly networkError: string | undefined;
  readonly triggerOnBlurIfFilled: (name: keyof LoginFormValues) => void;
  readonly clearCredentialsError: () => void;
};

// All of `<LoginForm>`'s form wiring: RHF + zod resolver, the credentials /
// network error split from `useLogin`, and the submit-time `mode` snapshot so
// `onSuccess` routes by the mode the user actually submitted under (not one
// toggled while the request is in flight). Keeps `<LoginForm>` to a hook call
// + JSX.
export function useLoginForm(
  mode: LoginMode,
  onSuccess: (data: LoginResponse, mode: LoginMode) => void,
): UseLoginFormResult {
  const { loginPrefillCredentials } = useSicoConfig();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    // Seed account for local dev; kept in sync with e2e + qa.md +
    // docs/infra/local-backend.md. Gated by SicoConfig so downstream apps
    // (dwp) can ship an empty form instead.
    defaultValues: loginPrefillCredentials
      ? { email: "operator@sico.local", password: "operator" }
      : { email: "", password: "" },
    // `onSubmit` mode + per-field blur-with-content guard below: empty
    // blurs stay quiet, non-empty invalid blurs surface zod inline.
    // `onChange` re-validation clears the error on the next valid keystroke.
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  // react-query rebuilds `onSuccess` from the latest render, so reading `mode`
  // there reports its value at resolution time. A user can toggle mode while
  // the request is in flight; snapshot the submitted mode in a ref so
  // `onSuccess` routes by what the user actually submitted under.
  const submittedModeRef = useRef<LoginMode>(mode);

  const login = useLogin({
    onSuccess: (data) => onSuccess(data, submittedModeRef.current),
    onCredentialsError: () =>
      form.setError("root.credentials", {
        message: "Incorrect email or password. Please try again.",
      }),
    onNetworkError: () =>
      form.setError("root.network", {
        message:
          "Couldn't reach the server. Please check your connection and try again.",
      }),
  });

  // Backend doesn't tell us which credential was wrong, so editing
  // either field clears the shared error.
  const clearCredentialsError = (): void => {
    if (form.formState.errors.root?.credentials) {
      form.clearErrors("root.credentials");
    }
  };

  // Blur trigger guarded so empty fields stay quiet (see RHF config above).
  const triggerOnBlurIfFilled = (name: keyof LoginFormValues): void => {
    if (form.getValues(name)) {
      void form.trigger(name);
    }
  };

  const onSubmit = form.handleSubmit((values) => {
    submittedModeRef.current = mode;
    login.mutate(values);
  });

  return {
    control: form.control,
    onSubmit,
    isPending: login.isPending,
    credentialsError: form.formState.errors.root?.credentials?.message,
    networkError: form.formState.errors.root?.network?.message,
    triggerOnBlurIfFilled,
    clearCredentialsError,
  };
}
