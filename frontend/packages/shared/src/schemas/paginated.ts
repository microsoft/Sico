// Canonical pagination shape for SICO list endpoints.
//
// Services normalise each backend response to this shape via a Zod
// `.transform` at the service layer. There is no shared schema
// factory — each endpoint's raw shape is too varied (different item
// keys, optional offset metadata) to make a single factory useful.
export type Paged<T> = {
  items: T[];
  total: number;
  hasNext: boolean;
};
