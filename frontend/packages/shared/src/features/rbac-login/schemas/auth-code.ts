// Reserved for extension — F1 only emits 401; F2+ will add more codes.
import { z } from "zod";

import { HTTP_UNAUTHORIZED } from "../../../constants/http";

export const authCodeSchema = z.literal(HTTP_UNAUTHORIZED);

export type AuthCode = z.infer<typeof authCodeSchema>;
