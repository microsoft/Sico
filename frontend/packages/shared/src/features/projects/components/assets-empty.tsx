import type * as React from "react";

import { MessageState } from "../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";
import type { AssetCategory } from "../types";

// §5 copy — verbatim. Heading is shared across every category AND the search
// variant so the MessageState shell stays heading+body consistent with the
// Empty frame (there is no dedicated search title key).
const TITLE = "No assets yet";

const CATEGORY_BODY: Record<AssetCategory, string> = {
  all: "Upload knowledge or wait for your digital workers to produce deliverables.",
  knowledge: "Add knowledge to give this project shared context.",
  deliverable:
    "Deliverables will appear here once your digital workers publish them.",
  experience:
    "Experiences will appear here as your digital workers learn from tasks.",
};

export type AssetsEmptyProps =
  | { variant: "category"; category: AssetCategory }
  | { variant: "search"; query: string };

// Narrow the union to its body line. Kept as a plain (non-component) helper so
// the discriminated union stays intact — destructuring `props` in the
// component signature would drop the `variant`→`category`/`query` correlation.
function resolveBody(props: AssetsEmptyProps): string {
  if (props.variant === "search") {
    return `No assets match "${props.query}". Try a different search.`;
  }
  return CATEGORY_BODY[props.category];
}

/**
 * Assets-table empty surface, in two shapes on the shared `MessageState`
 * primitive:
 *
 * - **`category`** — a category has zero rows. The heading is constant (`No
 *   assets yet`) and the body is the category-specific §5 line picked off
 *   `category`.
 * - **`search`** — a search returned nothing. Same heading; the body
 *   interpolates the live `{query}` into the `assets.search.empty` template.
 *
 * Uses the shared `cards` empty illustration. Layout/typography are owned by
 * `MessageState`; this wrapper only feeds illustration key + copy.
 */
export function AssetsEmpty(props: AssetsEmptyProps): React.JSX.Element {
  return (
    <MessageState
      illustrationUrl={EMPTY_ILLUSTRATIONS.cards.url}
      illustrationWidth={EMPTY_ILLUSTRATIONS.cards.width}
      illustrationHeight={EMPTY_ILLUSTRATIONS.cards.height}
      heading={TITLE}
      body={resolveBody(props)}
    />
  );
}
