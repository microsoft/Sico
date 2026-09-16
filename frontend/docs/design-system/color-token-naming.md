# Color Token Naming Specification

How SICO color tokens are named. The goal is a name you can **read as
intent** and **predict as a CSS property** — `--color-foreground-tertiary`
is text, `--color-stroke-strong-rest` is a border, `--color-button-primary-fill-rest`
is a background — without opening the stylesheet.

This is the *naming* contract. For the token **catalogue** (every token, its
value, and usage) see [sico-design-guideline.md](./sico-design-guideline.md).
For the *layering* contract (which layer may reference which) see the
`sico-add-tokens` skill.

---

## 1. Two naming layers

Every color token belongs to one of two layers, named on different principles.

| Layer | Principle | Pattern | Example |
|-------|-----------|---------|---------|
| **Primitive** | Non-semantic — names the *color*, not the use | `{hue}-{scale}` | `--color-neutral-800`, `--color-danger-500`, `--color-primary-600` |
| **Semantic** | Role-based — names the *use*, not the color | grammar below | `--color-foreground-primary`, `--color-button-primary-fill-rest` |

Primitive names like `--color-red-500` are **acceptable and expected** — a
numeric scale carries no design intent, so there is nothing to make semantic.
Components must not consume primitives directly (that is a layering rule, not a
naming rule); they exist so semantic tokens have something to reference.

Everything below governs the **semantic** layer.

---

## 2. The grammar

```
--color-{group}-{variant}-{element}-{state}
```

| Slot | Required | Meaning | Drawn from |
|------|----------|---------|------------|
| `group` | **yes** | The semantic family / head of the name | open set (§3) |
| `variant` | no | A sub-type inside the group | open set (§3) |
| `element` | no | Which part of the component is painted | **closed set** (§4) |
| `state` | no | Interaction / status | **closed set** (§5) |

Read left to right, the name narrows from *family* → *sub-type* → *part* →
*condition*. Only `group` is mandatory; simple tokens stop early.

```
--color-divider                              group
--color-foreground-tertiary                  group + state-like role
--color-status-warning-fill                  group + variant + element
--color-status-warning-foreground            group + variant + element
--color-button-primary-fill-rest             group + variant + element + state
--color-button-destructive-outline-stroke-hover   group + (compound variant) + element + state
```

`variant` may span more than one word (`destructive-outline`) when the design
genuinely nests a sub-variant. Keep it to what the design defines — do not
invent depth.

---

## 3. `group` and `variant` — open sets

These are not enumerable; they grow as the design system grows. Current groups:

| Group | Layer | Variants in use |
|-------|-------|-----------------|
| `surface` | Semantic | basic, canvas, sunken, acrylic-board, metric-board, user-input, inverted |
| `foreground` | Semantic | (states) emphasis, primary, secondary, tertiary, faint, disabled, on-inverted; (sub-group) link |
| `stroke` | Semantic | subtle-card, strong |
| `divider` | Semantic | — |
| `icon` | Semantic | primary, secondary, on-inverted |
| `focus` | Semantic | (states) rest, error |
| `status` | Component | success, warning, info |
| `button` | Component | primary, secondary, subtle, destructive, destructive-outline, link |
| `input` | Component | — |
| `link` | Component | — |

When you add a token, pick the existing group it belongs to before minting a
new one. A new group is a real addition to the system — treat it as such.

---

## 4. `element` — closed set

`element` answers **"what part is painted?"** It has exactly three values, and
each maps to one Tailwind utility prefix:

| `element` | Paints | Utility prefix | Example class |
|-----------|--------|----------------|---------------|
| `fill` | the body / background | `bg-` | `bg-button-primary-fill-rest` |
| `stroke` | the border | `border-` | `border-input-stroke-rest` |
| `foreground` | text / icon on top | `text-` | `text-button-primary-foreground-rest` |

No other element words exist. If a component needs a part outside this set, the
set is extended deliberately — not ad hoc.

---

## 5. `state` — closed set

`state` answers **"under what condition?"** Interaction states and status states
are both closed:

| `state` | Meaning |
|---------|---------|
| `rest` | default / idle (never `default`, never omitted-to-mean-rest when siblings have states) |
| `hover` | pointer over |
| `pressed` | active press / focus-pressed (never `active`) |
| `disabled` | non-interactive |
| `error` | invalid / error condition |
| `selected` | chosen in a set |

**Compound states** join two with a hyphen, condition then interaction:
`error-hover` (`--color-input-stroke-error-hover`).

> **Vocabulary is fixed.** Use `rest` not `default`; `pressed` not `active`.
> Mixed synonyms (`active` here, `pressed` there) break the predictability the
> grammar exists to provide.

---

## 6. Never encode the CSS property in the name

The utility prefix (`bg-` / `text-` / `border-`) already *is* the CSS property.
Repeating it in the token name is redundant and invites contradictions like
`bg-input-bg-rest`.

```
❌ --color-input-bg-rest      → bg-input-bg-rest         (property said twice)
❌ --color-input-border-rest  → border-input-border-rest
✅ --color-input-fill-rest    → bg-input-fill-rest
✅ --color-input-stroke-rest  → border-input-stroke-rest
```

`fill` / `stroke` / `foreground` are the sanctioned way to express *intent of
part* — they map onto `bg-` / `border-` / `text-` but are distinct words, so
the class never stutters (`bg-…-fill`, not `bg-…-bg`).

---

## 7. Position decides GROUP vs ELEMENT

`stroke` and `foreground` live in **two** slots. Their slot position
disambiguates the role — no extra marker needed:

| Word | In the **head** slot → GROUP | In a **later** slot → ELEMENT |
|------|------------------------------|-------------------------------|
| `stroke` | `--color-stroke-strong-rest` (a semantic border family) | `--color-input-stroke-rest` (the border *of* input) |
| `foreground` | `--color-foreground-primary` (the text family) | `--color-button-primary-foreground-rest` (the text *of* the button) |

So `foreground` is simultaneously a GROUP (the Semantic text family) and an
ELEMENT (a component's text part). Position, not spelling, tells you which.

---

## 8. A name predicts its CSS property — by layer

The whole point: given a token name, you know the property without looking it up.
*Where* the predictor sits depends on the layer:

| Layer | Predictor slot | Rule | Example |
|-------|---------------|------|---------|
| **Semantic** | `group` (head) | `surface→bg-`, `foreground→text-`, `stroke→border-`, `divider→border-`, `icon→text-`, `focus→outline-` | `foreground-tertiary` ⇒ text |
| **Component** | `element` | `fill→bg-`, `stroke→border-`, `foreground→text-` | `button-primary-fill-rest` ⇒ bg |

A Semantic token names a *family* and the family implies the property. A
Component token names a *part* and the part (`element`) implies the property.

A group pins **one** canonical property. When the same color is legitimately
reachable through a second CSS property, that path goes through an explicit
bridge — never a second prediction. `focus` predicts `outline-`
(`outline-focus-rest`); shadcn's `ring-*` utilities reach the same color only
via the `--color-ring` bridge (§9), not through this grammar.

---

## 9. The shadcn bridge layer keeps shadcn's names

shadcn components consume a fixed set of variables (`--color-background`,
`--color-foreground`, `--color-primary`, `--color-muted-foreground`, …). These
are **not** subject to this grammar — they are an external contract. Map them to
SICO semantic tokens via `var()`; do not rename them.

```css
/* shadcn bridge — names owned by shadcn, values owned by SICO */
--color-background: var(--color-surface-basic);
--color-muted-foreground: var(--color-foreground-tertiary);
--color-ring: var(--color-focus-rest); /* shadcn's ring-* consumes the focus color */
```

---

## Migration reference (this spec's first application)

The rename that introduced this spec. Left = pre-spec, right = current. CSS
variables shown; the Tailwind class is the same name under `bg-` / `text-` /
`border-` / `outline-`.

| Before | After | Rule |
|--------|-------|------|
| `--color-surface-bg-canvas` | `--color-surface-canvas` | §6 (drop `bg`) |
| `--color-surface-accent-user-input` | `--color-surface-user-input` | simplify variant |
| `--color-fg-*` | `--color-foreground-*` | spell `foreground` in full |
| `--color-fg-link-active` | `--color-foreground-link-pressed` | §5 (`active`→`pressed`) |
| `--color-link-color-*` | `--color-link-*` | §6 (drop `color`) |
| `--color-border-subtle-card-*` | `--color-stroke-subtle-card-*` | §3/§7 (`stroke` group) |
| `--color-border-strong-rest` | `--color-stroke-strong-rest` | §3/§7 (`stroke` group) |
| `--color-status-*-bg` | `--color-status-*-fill` | §4 (`fill` element) |
| `--color-status-*-text` | `--color-status-*-foreground` | §4 (`foreground` element) |
| `--color-button-*-text-*` | `--color-button-*-foreground-*` | §4 (`foreground` element) |
| `--color-input-*-active` | `--color-input-*-pressed` | §5 (`active`→`pressed`) |
| `--color-focus-ring-default` | `--color-focus-rest` | §5 (`default`→`rest`) + Component→Semantic (`focus→outline-`) |
| `--color-menuitem-*` | *(removed)* | unused — deleted |

`--color-divider` was already grammar-correct (group-only, predicts `border-`)
and was left unchanged.

---

## Migrating existing code

Code written before the rename still carries old class names. Migration is a
mechanical find → replace using the table above — but **lint is not a complete
safety net**, so the final check is grep, not lint.

Two mechanisms let a stale class survive *with green lint and no styling*:

- Tailwind v4 **silently drops** a utility whose `--color-*` variable is gone —
  no error is emitted, the class just produces no CSS.
- The `no-custom-classname` whitelist (`@sico/config`) uses broad regexes like
  `(bg|text|…)-(status|surface|…)-.+` that still **match** some old names and
  wave them through.

So the renames split in two:

| Old class | Lint result | Why |
|-----------|-------------|-----|
| `text-fg-*`, `text-link-color-*`, `bg-menuitem-*` | ✅ error | matches no variable **and** no whitelist regex |
| `bg-status-*-bg`, `bg-surface-bg-canvas` | ❌ silent, unstyled | whitelist regex still matches; variable is gone |

**Procedure:**

1. Replace each old fragment with its new form (left → right, table above).
2. `pnpm lint` — catches the `fg` / `link-color` / `menuitem` cases.
3. `grep -rE` each **old** fragment across `packages/{ui,shared,app}/{src,stories}`
   and expect zero hits — the **only** check that catches the silently-unstyled
   `status-*` / `surface-bg-*` renames.

A brand-new token group may also need its own whitelist regex in
`eslint.config.base.cjs`.
