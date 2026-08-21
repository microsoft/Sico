import { z } from "zod";

export const registerFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { message: "Please enter your email" })
    .min(3, { message: "Please enter a valid email" })
    .max(64, { message: "Email must be 64 characters or fewer" })
    .email({ message: "Please enter a valid email" }),
  password: z
    .string()
    .min(1, { message: "Please create a password" })
    .min(8, { message: "Password must be at least 8 characters" })
    .max(128, { message: "Password must be 128 characters or fewer" }),
});

export type RegisterFormValues = z.infer<typeof registerFormSchema>;
