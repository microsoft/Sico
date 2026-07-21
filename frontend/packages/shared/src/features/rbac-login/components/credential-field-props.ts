// Shared prop shape for `<EmailField>` / `<PasswordField>`: both share the
// same invalid styling + the two cross-field callbacks (blur-trigger and
// credential-error clear), so they take one shape.
import type { Control } from "react-hook-form";

import type { LoginFormValues } from "../schemas/login-form";

export type CredentialFieldProps = {
  readonly control: Control<LoginFormValues>;
  readonly hasCredentialsError: boolean;
  readonly triggerOnBlurIfFilled: (name: keyof LoginFormValues) => void;
  readonly clearCredentialsError: () => void;
};
