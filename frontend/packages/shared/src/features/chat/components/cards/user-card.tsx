import { type JSX } from "react";

export type UserCardProps = {
  text: string;
};

// Right-aligned user bubble. Plain text only (Markdown is AgentCard's job).
// `whitespace-pre-wrap` keeps typed newlines.
export function UserCard({ text }: UserCardProps): JSX.Element {
  return (
    <div className="bg-surface-user-input text-foreground-primary leading-body ml-auto w-fit max-w-150 rounded-xl px-4 py-3 text-base break-words whitespace-pre-wrap">
      {text}
    </div>
  );
}
