// Envelope code constants for the `{ code, msg, data }` contract.

export const HTTP_OK = 0 as const;
export const HTTP_UNAUTHORIZED = 401 as const;

// Synthetic envelope code emitted by the axios interceptor on network /
// schema-parse failure. Outside the HTTP-status range so downstream
// `switch (code)` cannot collide with real backend codes.
export const CLIENT_NETWORK_ERROR_CODE = 600 as const;
