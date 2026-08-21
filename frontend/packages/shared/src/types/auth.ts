// Outbound request contract — data WE construct and send, so its shape is
// guaranteed at compile time and needs no zod schema (unlike the inbound
// response, which is validated by `registerNewUserResponseSchema`).
export type RegisterNewUserRequest = {
  readonly email: string;
  readonly password: string;
};
