import {
  type RouterHistory,
  useCanGoBack,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

// Callers that open a detail page from OUTSIDE the project (dwp's notification
// center navigates in with `state: { fromNotification: true }`) set this so back
// lands on the DELIVERABLE LIST instead of `history.back()`-ing into whatever
// page preceded the notification. Read defensively — `location.state` is untyped
// here, so probe the flag without trusting the shape.
function isOpenedFromNotification(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "fromNotification" in state &&
    state.fromNotification === true
  );
}

/**
 * Shared "back" handler for the asset-detail pages (Knowledge / Experience /
 * Deliverable). Returns to the true origin via `history.back()` when the user
 * navigated here in-app; on a deep-link / refresh it navigates to the owning
 * project page. A `fromNotification` entry is special-cased to the DELIVERABLE
 * LIST (see below). Every asset-detail route nests under its project, so
 * `projectId` is always in hand — the fallback is a plain synchronous navigate.
 *
 * The handler is rebuilt every render (no deps array) so `canGoBack` always
 * reads the live in-app history index, never a stale closure.
 */
export function useAssetDetailBack(projectId: number): () => void {
  // `@sico/shared` is consumed without the app's router type registration, so
  // `useRouter().history` widens to `any`; the cast restores the typed
  // `RouterHistory` so `.back()` is checked. The typed `useCanGoBack` hook gates
  // the decision — both read the live in-app index, never a stale closure.
  const router = useRouter();
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- router type isn't registered in @sico/shared, so `.history` is `any`; the registered app router makes this a RouterHistory at runtime
  const history = router.history as RouterHistory;
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  const { state } = useLocation();
  const fromNotification = isOpenedFromNotification(state);
  return () => {
    // A notification entry resolves to the deliverable LIST, not history and not
    // the project root: the notification only ever opens a shared deliverable
    // (dwp's DELIVERABLE_SHARED card), and its pre-notification history belongs
    // to an unrelated page. NOTE: hard-coded to the deliverable category because
    // that is the only asset type notifications open today — revisit if a
    // knowledge/experience notification entry is added.
    if (fromNotification) {
      void navigate({
        to: "/project/$projectId/deliverable",
        params: { projectId: String(projectId) },
      });
      return;
    }
    if (canGoBack) {
      history.back();
      return;
    }
    void navigate({
      to: "/project/$projectId",
      params: { projectId: String(projectId) },
    });
  };
}
