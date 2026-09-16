# SICO Design Guideline

Design principles and usage guidance for the SICO design system. For token names, values, and usage comments see the single source of truth: `packages/ui/src/styles/globals.css`.

For how color tokens are *named* (the `--color-{group}-{variant}-{element}-{state}` grammar), see [color-token-naming.md](./color-token-naming.md).

---

## Elevation

> Tokens: `--shadow-s`, `--shadow-m`, `--shadow-l`, `--shadow-xl` in `globals.css` under `Foundation / Shadow`.

Elevation — bringing select elements forward using shadow and light — creates hierarchy. A clear visual hierarchy creates visual cues, aids scannability, and conveys levels of importance.

---

## Motion

> All motion tokens (easing, duration, animation composites) are in `globals.css` under `Foundation / Motion`. Use Tailwind classes `ease-entrance`, `duration-short-2`, `animate-pop`, etc.

Motion should be simple, direct, and should not add too much visual clutter. It should have moments of delight to create a subtle playful experience — not too quick nor too slow.

---

## Shape (Corner Radius)

Corner radius controls the roundness of UI elements, guiding the mood and personality of the interface. We use larger corner radii on controls and surfaces to make our UI feel warm, approachable, and instantly recognizable.

### Corner Ramp

Base unit = 4px. All corner values are multiples of this base.

| Token | Value | Tailwind Class |
|-------|-------|----------------|
| 0.5 base | 2px | `rounded-xs` |
| 1 base | 4px | `rounded-sm` |
| 2 base | 8px | `rounded-md` |
| 3 base | 12px | `rounded-lg` |
| 4 base | 16px | `rounded-xl` |
| 6 base | 24px | `rounded-2xl` |
| 9 base | 36px | `rounded-3xl` |
| Full | 9999px | `rounded-full` |

> **Note:** SICO uses Tailwind v4 default radius tokens. No custom CSS variables are emitted.

### Corner Smoothing (Concentric Corners)

Ensure nested elements have proportionally smaller corner radii to appear visually balanced.

**Formula:** `Inner radius = Outer radius - Padding`

| Guidance | |
|----------|---|
| Do | Match the corner radius of nested elements proportionally so they appear concentric and visually balanced |
| Don't | Set the inner element's corner radius larger or disproportionately smaller than the outer container's |

---

## Size

Base unit = 4px. All size values are multiples of this base.

> **Note:** SICO uses Tailwind v4 default spacing scale. Custom size tokens not yet defined.

---

## Spacing

Base unit = 4px. Spacing applies to both padding inside components and margin in page layouts.

### Spacing Principles

| Guidance | |
|----------|---|
| Do | Use tighter spacing to group related elements |
| Do | Use generous spacing between unrelated elements |
| Do | Use white space to give the user's eyes a chance to rest |
| Don't | Space related items too far apart |
| Don't | Make the whole page crowded |

> **Note:** SICO uses Tailwind v4 default spacing scale (4px base). Custom spacing tokens not yet defined.

---

## Typography

> Tokens: `--font-sans`, `--font-mono`, `--leading-*`, `--tracking-*` in `globals.css` under `Foundation / Typography`.

Typography doesn't just communicate information — it's a voice that carries personality, shaping how our product feels and connects. Its hierarchy guides the eye, organizing content and helping people find their way through an experience.

### Guidelines

| Guidance | |
|----------|---|
| Casing | Use sentence case for all UI text, including titles |
| Character count | Keep lines between 50-60 characters for optimal readability |
| Text contrast | Standard text: 4.5:1 minimum. Large text (18.5px bold / 24px regular): 3:1 minimum |
| Centering | Use discretion — only for short copy like titles |
| Alignment | Use baseline alignment in layouts with varying font sizes |