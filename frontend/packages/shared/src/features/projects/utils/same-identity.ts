// The client-side `.own` gate compares a backend identity field
// (`creator.username`, `agent.employerUsername`, `agent.operatorUsername`)
// against the current user's email (`userAtom.email` — the User schema carries
// no separate username). Those `*Username` fields and `email` are distinct
// backend columns that today hold the same value, so a plain `===` works — but
// it fails on a case difference (`Op@x` vs `op@x`). Compare case-insensitively
// and FAIL CLOSED on a missing/empty identity: a `.own` check that can't
// identify the owner must hide the action, never reveal it. (This is UX only —
// the backend re-authorizes every mutation.)
export function sameIdentity(
  candidate: string | null | undefined,
  userEmail: string | null | undefined,
): boolean {
  if (!candidate || !userEmail) {
    return false;
  }
  return candidate.toLowerCase() === userEmail.toLowerCase();
}
