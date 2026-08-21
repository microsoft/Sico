import {
  BookOpen,
  Brain,
  FileText,
  Hammer,
  SquareTerminal,
} from "lucide-react";
import { type JSX } from "react";

import { RecommendationTaskIconSchema } from "../../schemas/recommendation-task";

const { enum: Icon } = RecommendationTaskIconSchema;

// Maps a wire icon code to a lucide glyph (styling.md bans the legacy inline
// SVGs). Any unrecognized/future code — including UNKNOWN/FALLBACK — renders the
// console glyph, so a stray code degrades gracefully instead of throwing.
export function RecommendationTaskIconGlyph({
  icon,
}: {
  icon: number;
}): JSX.Element {
  switch (icon) {
    case Icon.BUILD:
      return <Hammer className="size-3.5" />;
    case Icon.THINK:
      return <Brain className="size-3.5" />;
    case Icon.WRITE:
      return <FileText className="size-3.5" />;
    case Icon.RESEARCH:
      return <BookOpen className="size-3.5" />;
    default:
      return <SquareTerminal className="size-3.5" />;
  }
}
