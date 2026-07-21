import type { ReactElement } from "react";

// Collapsed preview of the skill description: a masked, clamped block that
// expands the card on click (legacy StyledExpandSection collapsed region).
export function CollapsedDescription({
  description,
  onExpand,
}: {
  description: string;
  onExpand: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="block w-full pt-2 text-left"
    >
      <span
        className="text-foreground-emphasis leading-body block"
        style={{
          maxHeight: "4.2em",
          overflow: "hidden",
          maskImage: "linear-gradient(to bottom, #000 45%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, #000 45%, transparent 100%)",
        }}
      >
        {description}
      </span>
    </button>
  );
}
