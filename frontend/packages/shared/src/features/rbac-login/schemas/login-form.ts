// Bounds (email 3..64, password 6..128) mirror backend `binding` tags in
// `internal/transport/http/dto/rbac/token/token.pb.go` — keep in sync.
// Custom `message`s here go straight to the user via <FieldError>;
// keep them friendly + actionable.
import { z } from "zod";

export const loginFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3, { message: "Email must be at least 3 characters" })
    .max(64, { message: "Email must be 64 characters or fewer" })
    .email({ message: "Please enter a valid email" }),
  // No `.trim()` — leading / trailing space may be part of the secret.
  password: z
    .string()
    .min(6, { message: "Password must be at least 6 characters" })
    .max(128, { message: "Password must be 128 characters or fewer" }),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;
