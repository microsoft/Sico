import { type Message } from "../atoms/chat-atom";

// The backend splits one logical turn across several history rows sharing a
// `turnId` (plan + text + experience). `messageItemSchema` maps each row 1:1 to a
// `Message`, so without this fold one turn renders as several stacked cards.
// `groupTurns` collapses a run of same-`(turnId, author)` messages into one
// envelope — Parts concatenated (plan stays ahead of text via wire ordering),
// attachments merged, `createdAt` taken as the latest.
//
// Identity is the FIRST row's id (stable across re-hydration). A message without
// a `turnId` — the live streaming tail — never groups: it passes through
// untouched, keeping its object reference so use-history preserves the tail.
export function groupTurns(messages: Message[]): Message[] {
  const grouped: Message[] = [];
  for (const message of messages) {
    const prev = grouped.at(-1);
    const sameTurn =
      prev !== undefined &&
      message.turnId !== undefined &&
      prev.turnId === message.turnId &&
      prev.author === message.author;
    if (!sameTurn) {
      grouped.push(message);
      continue;
    }
    // Fold this row into the open turn via a merged copy — never mutate inputs.
    const mergedAttachments = [
      ...(prev.attachments ?? []),
      ...(message.attachments ?? []),
    ];
    const merged: Message = {
      ...prev,
      content: [...prev.content, ...message.content],
      createdAt: message.createdAt ?? prev.createdAt,
      // The experience count/playbookId ride a sibling type=8 item; carry both
      // onto the folded turn (a turn carries at most one), else the
      // ExperiencePill's `View more` jump goes dead on every grouped turn.
      experienceCount: message.experienceCount ?? prev.experienceCount,
      experiencePlaybookId:
        message.experiencePlaybookId ?? prev.experiencePlaybookId,
      // The inline plan seed rides the type=9 row, which is usually first (so
      // `...prev` carries it) but need not be — carry it explicitly so a plan
      // folded in as a non-first row still seeds `plansAtom` (a turn has one
      // plan). `use-history` reads `seedPlan` off THIS grouped message.
      seedPlan: prev.seedPlan ?? message.seedPlan,
    };
    if (mergedAttachments.length > 0) {
      merged.attachments = mergedAttachments;
    }
    grouped[grouped.length - 1] = merged;
  }
  return grouped;
}
