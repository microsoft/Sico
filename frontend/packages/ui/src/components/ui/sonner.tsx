// Stock shadcn Sonner (https://ui.shadcn.com/docs/components/radix/sonner)
// with two SICO deviations, both documented in the MDX Upstream Audit:
//   1. SICO is single-theme, so `useTheme()` is dropped and `theme`
//      defaults to "light".
//   2. Toasts render `unstyled` and are fully re-skinned through sonner's
//      `classNames` slot map with SICO tokens. sonner's own
//      `[data-styled=true]` card CSS (fixed padding/radius/shadow + a
//      single `--normal-bg`) can't express the two-tier white/black
//      surface or the per-type tints the design needs, and its 0,2,0
//      specificity would beat single-class utilities. All runtime
//      behavior — positioning, stacking, swipe-to-dismiss, durations, the
//      success/info/warning/error/loading/promise API — is untouched;
//      only presentation moves to tokens.
//
// Surface is chosen per-toast: white (informational) is the default;
// black (transient) toasts opt in with sonner's native `invert` flag at
// the call site — `toast.success("Copied", { invert: true })` — which
// stamps `data-invert="true"` that the slot classes key off.
//
// The two surfaces render at different screen positions (design): white
// bottom-right, black bottom-center. sonner scopes position/offset per
// `<Toaster>`, so `<Toaster>` mounts TWO `<SonnerToaster>` — a default
// (white) and one with `id="inverted"` — and the `toast` export below is
// a thin wrapper that injects `toasterId: "inverted"` whenever
// `invert === true`. So the single `invert` flag does both jobs: styles
// the card AND routes it to the black surface. Call sites are unchanged
// (they still only pass `invert`); this is why the `toast` re-export is
// no longer raw — documented in the MDX Upstream Audit.
//
// The toast <li> receives `classNames.toast` + the unconditional
// `classNames.default` + `classNames[type]` in one space-joined string
// (sonner does NOT run tailwind-merge), so competing bare `bg-*`
// utilities would resolve by stylesheet order. To stay deterministic,
// the surface is driven off sonner's `data-type` / `data-invert`
// attributes inside the single `toast` slot, and the per-type slots are
// left unset. The non-inverted base carries an UNGATED white fill —
// sonner renders a bare `toast()` with NO `data-type`, so a
// `data-[type=default]` gate would never match and leave the body
// transparent. The tinted status gates (info/warning/error) carry an
// extra `[data-type]` attribute, so their specificity (0,3,0) beats the
// base fill (0,2,0) and they layer on top whenever a kind is set.
import {
  IconAlertTriangleFilled,
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconInfoCircleFilled,
} from "@tabler/icons-react";
import { Loader2Icon, XIcon } from "lucide-react";
import type { ReactElement } from "react";
import {
  type ExternalToast,
  toast as sonnerToast,
  Toaster as SonnerToaster,
  type ToasterProps,
} from "sonner";

import { cn } from "../../lib/utils";

// Toasts fired with `invert: true` route to the inverted `<SonnerToaster>`
// (see the `toast` wrapper + `<Toaster>` below). This id is the single
// coupling point between the wrapper that WRITES `toasterId` and the
// `<SonnerToaster id>` that READS it — co-located so they cannot desync.
const INVERTED_TOASTER_ID = "inverted";

const TOAST_CLASSNAME = cn(
  // Shared chrome (white surface is the rest state). Fixed 320x64 footprint
  // with content vertically centered — single-line copy sits mid-card and
  // two-line copy still centers as a block within the fixed height. `h-16!`
  // beats sonner's `height:var(--initial-height)` (0,3,0) applied on hover
  // expansion, so the toast doesn't resize when the pointer enters.
  "shadow-l text-foreground-primary flex h-16! w-80 items-center gap-2 rounded-xl p-3 text-sm",
  // Trailing slot is mutually exclusive per design: a toast shows the `View`
  // action OR the close X, never both. Sonner renders both if a call site
  // passes both, so when an action is present, hide the close X.
  "[&:has([data-button])_[data-close-button]]:hidden",
  // White surface: ungated base fill so a bare `toast()` (no data-type)
  // still paints. The status tints below layer on top via specificity.
  "not-data-[invert=true]:border-stroke-subtle-card-rest not-data-[invert=true]:bg-surface-basic not-data-[invert=true]:border",
  // White surface, status tints — gated to non-inverted + a specific type,
  // so they outrank the base fill. Info stays on the plain white base (its
  // blue glyph pairs with white, not the warm warning tint — per design);
  // only warning/error carry a tint.
  "not-data-[invert=true]:data-[type=warning]:bg-status-warning-subtle-fill",
  "not-data-[invert=true]:data-[type=error]:bg-status-error-subtle-fill",
  // White loading toast: indeterminate primary hairline at the bottom edge.
  "not-data-[invert=true]:data-[type=loading]:toast-loading-bar",
  // Black/inverted surface: one fill, tighter hug footprint, no per-type tint.
  // `h-auto!` cancels the shared 320x64 footprint (also important) so black
  // toasts hug content.
  "data-[invert=true]:h-auto! data-[invert=true]:min-h-10 data-[invert=true]:w-auto data-[invert=true]:max-w-60 data-[invert=true]:gap-2 data-[invert=true]:rounded-lg data-[invert=true]:px-3 data-[invert=true]:py-2",
  "data-[invert=true]:bg-surface-inverted data-[invert=true]:text-foreground-on-inverted",
  // Icons on the black surface: default to white (info/loading/plain),
  // then per-type overrides for success/warning/error use mid-tone status
  // tokens tuned for dark backgrounds — the standard status-foreground
  // tokens (danger-700 / warn-600) read muddy on black. Descendant
  // selector overrides the per-type color set on the icon nodes in `ICONS`.
  "data-[invert=true]:[&_[data-icon]>svg]:text-icon-on-inverted",
  "data-[invert=true]:data-[type=success]:[&_[data-icon]>svg]:text-status-success-on-inverted-foreground",
  "data-[invert=true]:data-[type=warning]:[&_[data-icon]>svg]:text-status-warning-on-inverted-foreground",
  "data-[invert=true]:data-[type=error]:[&_[data-icon]>svg]:text-status-error-on-inverted-foreground",
);

const TOAST_OPTIONS: ToasterProps["toastOptions"] = {
  unstyled: true,
  classNames: {
    toast: TOAST_CLASSNAME,
    content: "flex min-w-0 flex-1 flex-col gap-0.5",
    title: "text-sm leading-tight font-normal line-clamp-2",
    description: "text-sm leading-tight text-foreground-secondary line-clamp-2",
    icon: "flex size-4 shrink-0 items-center justify-center [&>svg]:size-4",
    // sonner wraps loading icons in `.sonner-loader` which is
    // `position:absolute; top/left:50%; transform:translate(-50%,-50%)` —
    // it floats the spinner over the toast center. Reset positioning
    // (position + inset + the shorthand `transform:translate()` sonner uses,
    // which Tailwind's `translate-*` utilities don't override — they set the
    // `translate` property, not `transform`) so the icon slot places it
    // inline with the other status glyphs.
    loader:
      "static! inset-auto! transform-none! flex size-4 shrink-0 items-center justify-center [&>svg]:size-4",
    // "View" — SICO subtle button (sm). Optional per call site, and only
    // on the white surface (inverted toasts carry no action), so no
    // on-inverted variant is needed here.
    actionButton: cn(
      "ml-auto inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-sm font-medium",
      "text-foreground-primary hover:bg-button-subtle-fill-hover",
    ),
    // Close X — pulled out of sonner's absolute top-corner placement into
    // an inline trailing slot (order-last) so it occupies the row's end.
    // Per design the X and the `View` action share this one trailing slot
    // and are mutually exclusive per call site (a toast carries an action
    // OR a close X, never both). `static` clears sonner's `position:absolute`.
    closeButton: cn(
      "static! order-last size-5 shrink-0 rounded-sm",
      "text-foreground-secondary border-none bg-transparent",
      "opacity-40 transition-opacity hover:opacity-100",
    ),
  },
};

// Filled tabler glyphs (size-4), colored via SICO status-foreground tokens.
// Warning uses the `-strong` glyph tone (warn-600) so it reads on the
// low-emphasis subtle tint while the base warning-foreground (warn-700)
// stays reserved for AA-text consumers.
const ICONS: ToasterProps["icons"] = {
  success: <IconCircleCheckFilled className="text-status-success-foreground" />,
  info: <IconInfoCircleFilled className="text-foreground-secondary" />,
  warning: (
    <IconAlertTriangleFilled className="text-status-warning-strong-foreground" />
  ),
  error: <IconCircleXFilled className="text-status-error-foreground" />,
  loading: <Loader2Icon className="text-foreground-secondary animate-spin" />,
  // Override sonner's default 14px stroke-1 X to match the FileTile dismiss
  // (size-4 + stroke-1.5) — the default reads too small and faint next to
  // the size-4 status glyphs.
  close: <XIcon className="size-4" strokeWidth={1.5} />,
};

// `invert` is the single source of truth for a black toast: sonner stamps
// `data-invert` (styling) and we inject `toasterId` so it renders in the
// inverted `<SonnerToaster>` (positioning). If invert !== true the data
// passes through untouched.
function withInverted(data?: ExternalToast): ExternalToast | undefined {
  if (data?.invert !== true) {
    return data;
  }
  return { ...data, toasterId: INVERTED_TOASTER_ID };
}

type ToastApi = typeof sonnerToast;

// A thin wrapper over sonner's `toast` that auto-routes `invert: true`
// calls to the inverted surface. Hand-written (not a Proxy — Proxy traps
// are inherently untyped). The `message`/`data` params are contextually
// typed from sonner's own signatures via the annotations, so no `any` and
// no need to import the unexported `titleT`. The final `: ToastApi`
// annotation is a compile-time contract: it breaks the build if sonner's
// shape ever drifts, and guarantees every existing `import { toast } from
// "@sico/ui"` consumer keeps working unchanged.
const base: (...args: Parameters<ToastApi>) => ReturnType<ToastApi> = (
  message,
  data,
) => sonnerToast(message, withInverted(data));

const injected: Pick<
  ToastApi,
  "success" | "info" | "warning" | "error" | "loading" | "message" | "custom"
> = {
  success: (message, data) => sonnerToast.success(message, withInverted(data)),
  info: (message, data) => sonnerToast.info(message, withInverted(data)),
  warning: (message, data) => sonnerToast.warning(message, withInverted(data)),
  error: (message, data) => sonnerToast.error(message, withInverted(data)),
  loading: (message, data) => sonnerToast.loading(message, withInverted(data)),
  message: (message, data) => sonnerToast.message(message, withInverted(data)),
  custom: (jsx, data) => sonnerToast.custom(jsx, withInverted(data)),
};

// Pass through verbatim. sonner's methods are instance-field arrows bound
// to its store, so bare references stay bound. `dismiss` is global-by-id
// (it reaches whichever surface holds the id), so it needs no routing.
// `promise` isn't wrapped — its `PromiseData` shape differs and no call
// site pairs it with `invert`.
const passthrough: Pick<
  ToastApi,
  "promise" | "dismiss" | "getHistory" | "getToasts"
> = {
  promise: sonnerToast.promise,
  dismiss: sonnerToast.dismiss,
  getHistory: sonnerToast.getHistory,
  getToasts: sonnerToast.getToasts,
};

export const toast: ToastApi = Object.assign(base, injected, passthrough);

// Screen placement per surface (design). Numeric px offsets are sonner
// JS-API values, not Tailwind classNames — the no-arbitrary-value styling
// rule targets className visual values, not component props (same category
// as `LucideProvider strokeWidth={1}`).
const WHITE_OFFSET = { right: 32, bottom: 44 };
const BLACK_OFFSET = { bottom: 44 };

// position/offset are now per-surface design decisions owned here, so they
// drop off the public prop surface; the remaining ToasterProps (theme,
// expand, duration, gap, visibleToasts, hotkey, …) apply to both instances.
type SicoToasterProps = Omit<
  ToasterProps,
  "id" | "position" | "offset" | "mobileOffset"
>;

export function Toaster({
  theme = "light",
  ...props
}: SicoToasterProps): ReactElement {
  const shared = {
    theme,
    icons: ICONS,
    toastOptions: TOAST_OPTIONS,
    ...props,
  };
  return (
    <>
      {/* White (informational) — renders toasts with no toasterId. */}
      <SonnerToaster
        {...shared}
        position="bottom-right"
        offset={WHITE_OFFSET}
      />
      {/* Black (transient) — renders only toasts the wrapper routed here. */}
      <SonnerToaster
        {...shared}
        id={INVERTED_TOASTER_ID}
        position="bottom-center"
        offset={BLACK_OFFSET}
      />
    </>
  );
}
