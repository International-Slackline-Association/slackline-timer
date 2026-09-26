# The Component Layer — "Micro Templates"

> Companion to `design-system.md`. That doc defines the **tokens and the look** (color, type,
> spacing, the race-state language). This doc defines the **reusable components** that render that
> look — the small, presentational, formatting-owning building blocks that sit between the raw
> tokens and the pages, and guarantee that the same visual concern is drawn the same way
> everywhere. Internally we call them **micro templates**: not page templates, but the smallest
> unit of "this is how we render a _thing_" (an athlete name, an elapsed time, a plate, a flag).

This is a **knowledge + strategy** document, not an ADR. It captures the research behind the
approach, applies it to this repo's three surfaces, names the concrete components worth extracting,
and lists the open questions that still need a decision. Nothing here changes code by itself.

---

## 1. What problem the micro-template layer solves

The design tokens are already single-sourced and guarded (`tokens.ts` ↔ `tokens.css` parity test).
The **labels and pure formatting** are also largely centralized (`roundLabel`, `genderLabel`,
`formatMs`, `resultLabel`). What is _not_ centralized is the **visual rendering of recurring
domain concepts** — and that is exactly where drift creeps in.

A concept like "an athlete's name, LAAX-styled (bold first / light last, caps)" is a token
_composition_: it uses `fonts.display`, a tracking value, a shadow policy, and a first/last split
rule. Tokens alone can't guarantee it renders identically in the VS card, the rankings row, and the
bracket — only a **shared component** can. Today that split is implemented three times (see §7).

The micro-template layer is the answer to: _"how do we make 'render an X' a single decision,
reusable across MUI admin, operator controls, and non-MUI broadcast overlays, without a monolithic
component that tries to do everything?"_

The three properties the user asked for map onto three mechanisms:

| Goal                       | Mechanism                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Consistent look**        | One component per concept, styled only from tokens; enforced by lint + review.                                                                                |
| **Proper formatting**      | Formatting logic lives in `app/util/*` (pure) and is _consumed_ by exactly one presentational component per concept — never re-derived at a call site.        |
| **Consistent integration** | A small, predictable component API (variants + slots + polymorphism) so the _same_ component drops into all three surfaces with only a context prop changing. |

---

## 2. The layering model (and why not literal "atomic design")

Every mature design system layers **primitives → patterns → templates**. The value is the layering,
not the vocabulary.

**Atomic design (atoms/molecules/organisms/templates/pages) is a poor fit for our code**, for
reasons that recur across the literature:

- Its category boundaries are **ambiguous in practice** — even experienced practitioners can't
  reliably classify a dropdown or a masthead, which turns into taxonomy debates instead of
  clarity. Its own critics accept the _compositional premise_ but reject the biological naming.
  [Atomic-design critique — D'Amato]
- It layers by **visual complexity only**, and so **doesn't model state, interaction, or business
  logic** — the things our timer/overlay components actually carry. Strict adherence tends toward
  **over-fragmentation** (too many tiny components, logic smeared across levels).
  [Atomic-design critique — dev.to]
- Frost's own newer framing has moved on to **core / recipe / smart** layers (see below), which
  maps onto real inventories better. [Brad Frost — design-system ecosystem]

**The model we should use** (Brad Frost's mature "design system as ecosystem", lightly adapted):

1. **Tokens** — `theme/` (done).
2. **Primitives** — intentionally "dumb", presentation-only, token-consuming. A polymorphic `Box`,
   a `Text`/`Numeral`, a `Plate`. These are the best reuse candidates precisely because they're
   small. [redux-maintainer Erikson: smaller/more-primitive components reuse better]
3. **Components ("micro templates")** — a _promoted_ pattern: `AthleteName`, `ElapsedTime`,
   `RankBadge`, `FlagRow`. Content-agnostic, token-styled, one per concept.
4. **Recipes** — product-/surface-specific compositions built _from_ the above by the page author
   without changing the shared layer: `VsOverlay`, `RankingsOverlay`, an admin `TimesTable`.
   Recipes that prove reusable **graduate** into layer 3 — this is the promotion rule (§8).
5. **Pages / routes** — the `/stream/*`, `/admin/*`, control pages.

> Practical naming, borrowed from the critique that fixes atomic design's real flaw: a **pattern**
> is an as-yet-unnamed recommended composition; a **component** is a pattern that's been _promoted_
> to a packaged, reusable resource. Promotion is a deliberate step, not automatic. [D'Amato]

---

## 3. Component API design — composition vs configuration

There are two fundamental API models, and a team should **pick a default philosophy explicitly and
early** rather than deciding per component. [DS-API model — composition-vs-configuration]

- **Configuration** — the consumer passes data/props; the component renders itself. Maximal control
  and enforced consistency for the DS team; but as requirements grow it suffers **prop explosion**
  (components accreting tens of props / render-props until they're unmaintainable) and becomes
  hard to override for anything slightly off-default. The canonical war story is a `Formik`-wrapping
  `Input` that grew a render-prop per feature until it collapsed. [prop-explosion case studies]
  Shopify **Polaris** sits at this tightly-controlled end. [flexibility-spectrum]
- **Composition** — the consumer assembles small building blocks (compound components, slots). Lower
  maintenance burden and far more flexible, but shifts responsibility for correctness (a11y,
  consistency) onto the consumer. Rewards teams with strong frontend engineers. **MUI** sits at the
  flexible end; unconstrained flexibility is what _produces_ inconsistency. [flexibility-spectrum]

**The recommended middle ground is slot-based compound components.** Named slots
(e.g. GitHub Primer's `ActionList.LeadingVisual`, React Aria's `slot="previous"`) accept only
specific children, keep positioning/styles _inside_ the component so children "always end up in the
right position", and hide implementation detail while still allowing flexible content. Compound
components share state implicitly via **React Context** (much easier since React 16.3), avoiding both
prop explosion and free-form-CSS drift. [slots middle-ground; compound-components]

**For this repo:** default to **configuration for leaf micro-templates** (an `ElapsedTime`, an
`AthleteName`, a `RankBadge` — these _should_ be locked down; consistency is the whole point) and
**composition/slots for containers** (a `Plate`, a `StatCard`, the overlay shells). This matches our
reality: leaf renderers must be identical everywhere; containers must flex across three surfaces.

### Polymorphism: `as` / `component` vs Radix `asChild`

Both let one component render different elements. They are **not** equivalent, and each has a real
tax — relevant because our primitives (`Box`, `Text`) will want polymorphism:

- **Polymorphic `as` / MUI's `component` prop** — widespread (Styled Components, Chakra, MUI, React
  Spectrum, Atlassian). Type-safe in principle (generics infer the target's props), but: it does
  **no prop merging** (the consumer must forward props/refs itself), it **fails silently** when a
  forwarded prop isn't supported (no TS error, no runtime error — the prop just does nothing),
  correctly typing it (esp. with refs) is **complex and can degrade `tsc` performance**, and TS 5's
  stricter checking broke some nested-polymorphic usages. [polymorphic-as pitfalls]
- **Radix `asChild`** (a `Slot` that merges parent props into the child via `React.cloneElement`) —
  ergonomic and chainable, but **weakens TypeScript checking on the child** (compiles, fails at
  runtime), and `cloneElement` is **soft-deprecated** by the React core team and **breaks under
  React Server Components** (async children vanish). [asChild pitfalls]
- Headless libraries **split into two camps** on this: **DX-first** (Radix, Ark — accept
  runtime discovery via `asChild`) vs **robustness-first** (React Aria, Ariakit, Base UI — prefer
  render-props/hooks that fail at _compile_ time). For long-lived projects the guidance leans toward
  the explicit, type-safe end. [headless camps]

**For this repo:** we're not SSR (Vite SPA), so the RSC objection is moot, and we don't need a
headless library at all. Use the plain **`component`/`as` prop** on our own primitives (it's what
MUI already gives us via `Box`/`Typography`), keep the polymorphic surface **small** (one or two
primitives), and don't chase `asChild` — its costs buy us nothing here.

---

## 4. How real design systems solve "same component, multiple visual contexts"

This is our central constraint: the _same_ concept renders on an MUI admin page, an operator
control page, and a chroma-keyed OBS overlay. The established answers:

- **MUI (our framework) — theme `variants`.** The theme's `components.<Name>` key exposes three
  app-wide levers: `defaultProps`, `styleOverrides` (keyed by **slot name**, `root` = outermost,
  nested selectors allowed), and **`variants`** — an array of `{ props, style }` entries applied
  whenever an instance's props match; the matcher **can be a callback** for conditional styling.
  This is MUI's _official_ answer to one-component-many-contexts: encode the contexts once in the
  theme, select with a prop. [MUI theme-components] But MUI also warns the **theme isn't
  tree-shakable**, so **heavy** customizations belong in a **wrapper component**, not the theme.
  [MUI theme-components] → our leaf micro-templates should be _wrappers_, using theme `variants`
  only for light, prop-selected skinning.
- **Adobe React Spectrum — separate behavior from style into layers.** Split into **React Stately**
  (pure state/logic, no platform or theme), **React Aria** (web behavior + a11y + locale-aware
  formatting), and **React Spectrum** (Adobe styling). The explicit goal: **reuse behavior,
  interactions, a11y, and i18n across design systems and visual contexts, while styling stays local
  to each.** The behavior layer is **hooks that return props you spread onto your own DOM**, and
  React Aria ships **zero default styling**. [React Spectrum; React Aria] → our analogue already
  exists: the _pure logic_ is in `app/util/*` and hooks; the _rendering_ is per-surface. Keep that
  seam clean.
- **Braid (SEEK) — the strict end.** Goal: build UIs **entirely from prop interfaces**, no custom
  styling. High-level components (`Text`, `Heading`, `Card`, `Button`) **deliberately omit
  `className`/`style`** so gaps surface as explicit requests instead of local overrides; the single
  escape hatch is a low-level **`Box`** exposing themed atomic styles via props + a polymorphic
  `component` prop. [Braid] → the lesson for us: **overlays should not accept arbitrary
  `sx`/`style` for concepts we've templated.** If a plate needs a new variant, add it to the
  component, don't patch it at the call site.
- **The hybrid (recommended).** Build composable **primitives**, then wrap them in **opinionated,
  configured** components for the common cases. Consistency _and_ flexibility, layered.
  [hybrid layering]

**Verdict for Slackline Timer:** we already have the right substrate (one token source in two
forms). The missing piece is the **wrapper/variant discipline**: one component per concept, a
`context`/`variant` prop (e.g. `"admin" | "control" | "broadcast"`) that selects sizing/shadow
policy, styled only from tokens, with **no `sx` escape hatch on templated concepts**.

---

## 5. Token integration — the one thing to get right

Tokens are reached **two different ways** in the codebase today (see §7): some files import the
`colors`/`fonts` **objects**, others use raw **`var(--tl-*)`** strings — for the _same_ token. Both
are correct, neither is enforced, and the inconsistency is real. The research points at the
resolution:

- Referencing tokens as **CSS custom properties** (rather than resolved hex) makes the token
  **visible in dev tools** — "which token is this?" is answerable by non-devs too. [MUI RFC #27651]
- CSS variables are the mechanism by which **multiple visual contexts / design systems coexist**
  (the RFC's per-system prefix, `--md-…` / `--joy-…`); and they're **consumable from plain CSS**,
  which is exactly how a non-MUI overlay shares the MUI palette with zero duplication.
  [MUI RFC; MUI css-vars usage]
- MUI v5's `CssVarsProvider` can auto-generate `--mui-*` vars from the theme and expose a
  `theme.vars` object mirroring the theme shape. **Caveat, from adversarial verification:** it is
  **not** vendor _mandated_ that you consume tokens via `theme.vars` (that overclaim was refuted
  0-3), and `CssVarsProvider` is **not** the only bridge between TS tokens and CSS-var surfaces (also
  refuted). Treat it as _an_ option, not gospel — and note it's an **experimental** v5 API. Our
  hand-rolled `tokens.ts` + `tokens.css` + parity test is a **legitimate equivalent** and doesn't
  need replacing.

**Decision (§10 Q1):** keep the existing dual-source-of-truth + parity test, and adopt **one
convention, enforced by lint**: _inside a React/MUI tree, reach tokens through the theme
(`theme.palette` / imported `colors`); only reach for `var(--tl-*)` in genuinely non-React CSS
(SVG, canvas, raw `document.body` styling)._ This is a lint rule, not just a doc line — the
micro-template components then have a single, checkable access path.

### Enforcement is the point — and it can be automated

Consistency that relies on reviewer memory decays. Production systems enforce tokens with **ESLint
rules**, not convention:

- **Atlassian** ships `@atlaskit/design-system/ensure-design-token-usage` — hard-coded values and
  legacy colors are **violations**, with auto-fix + IDE suggestions. Rationale is **theming
  correctness**: any surface styled outside the token system silently breaks on theme switch, so
  enforcement must be **total, not advisory**. [Atlassian]
- **MetaMask** ships `color-no-hex`, flagging any hex literal in styles, framed explicitly as a
  **consistency / scalability / maintenance** guarantee. [MetaMask]

**We have a gap here.** Our only styling guardrail is the token _parity_ test; ESLint has **no**
rule against raw hex or off-token `sx`. Adding a `no-restricted-syntax` rule that flags hex literals
in `.tsx` (allow-listing `tokens.ts`/`tokens.css`/`overlayBg.ts`) would turn the DESIGN_SYSTEM's
"never inline a raw hex" from a comment into a check. This is the single highest-leverage,
lowest-risk enforcement step.

---

## 6. Formatting components — the "proper formatting" half

The user's phrase "allow proper formatting" is the tell that this isn't only about color. The rule:

> **Pure formatting logic lives in a single pure module and is rendered by exactly one
> presentational component per concept. A call site never re-derives a format.**

We're half-way there — the _format_ logic is centralized (mostly in `app/util/*`); the _rendering_
is not. Concretely, we want a tiny family of formatting micro-templates that each wrap a pure
formatter:

| Component               | Wraps (formatter)                                                                                                                 | Renders                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Numeral` / `<Numeral>` | —                                                                                                                                 | any number with `fonts.numerals` + `tabular-nums` (fixed-width digits — the non-negotiable rule in DESIGN_SYSTEM §4). Kills ~8–9 inline copies of that `sx`. |
| `ElapsedTime`           | `formatMs` (+ `DNF_LABEL`), `app/util/time.ts`                                                                                    | a race time / countdown, DNF-aware, one format. Replaces `Stopwatch.formatTime` and `Countdown.formatClock`.                                                 |
| `AthleteName` (exists)  | `splitName` / `fullName`, `app/types.ts` (ADR 0016) — **not** `app/util`                                                          | bold-first / light-last caps. Already exists — the job is to _route the other two copies through it_, likely via a `sizing` (`"fixed"`/`"cqh"`) prop.        |
| `FlagRow`               | `toAlpha2`, `components/CountryFlag.tsx` (map in `components/iocAlpha2.ts`) — shared but **not** homed under `app/util`           | one/two nations. Unify `CountryFlag` (MUI) and `FlagBlock(s)` (CSS-bg) behind one API with a `variant`.                                                      |
| `RankBadge`             | `rankLabels` — **currently local** to `RankingsOverlay.tsx:28`, not a util; **extract to `app/util` first** (formatter-first, §8) | rank with tie (`=`) handling.                                                                                                                                |
| `ResultText`            | `resultLabel` / `freestyleResultLabel`, `app/util/resultLabel.ts`                                                                 | the "time or DNF or score" string.                                                                                                                           |

> **Formatter homes are inconsistent today.** Some formatters are in `app/util` (`formatMs`,
> `resultLabel`); others live where they were first needed (`splitName` in `app/types.ts`, `toAlpha2`
> in `components/CountryFlag.tsx`, `rankLabels` inline in `RankingsOverlay.tsx`). The rule above says
> "a single pure module", not literally `app/util` — but the `RankBadge` work must **extract
> `rankLabels` out of the overlay into a util before wrapping it** (do the pure extraction first, per
> §8). `splitName`/`toAlpha2` are already shared, just not co-located; homing them under `app/util`
> is optional cleanup, not a blocker.

The fixed-width-digit rule is a perfect example of why _tokens aren't enough_: `.tnum`/`.numerals`
classes already exist in `tokens.css` but **no TSX uses them** — the intent exists, the enforcement
doesn't. A `Numeral` component makes it un-skippable.

---

## 7. Current state of this codebase (the duplication map)

A full survey of `web/src` (paths current as of this writing) found the layer **half-built**: tokens
and labels are centralized; visual concepts are not. The concrete hotspots that justify the
component candidates above:

**Well-centralized already (don't touch):**

- Round labels — `app/util/rounds.ts` (`roundLabel`, `displayRoundName`), routed everywhere.
- Gender labels — `app/util/gender.ts` (`genderLabel`).
- Time _format_ — `app/util/time.ts` (`formatMs`, `DNF_SENTINEL`, `DNF_LABEL`).
- Result strings — `app/util/resultLabel.ts`.
- Name split — `splitName`/`fullName` in `app/types.ts` (ADR 0016); shared, though it lives in
  `types.ts` rather than `app/util`.
- Country-code normalize — `toAlpha2` in `components/CountryFlag.tsx` (map in
  `components/iocAlpha2.ts`); shared by both flag components, though co-located with the MUI one.
- Token parity — `web/test/app/theme/tokens.parity.test.ts` (the one real styling guardrail).

**Centralized in _label_ but not in _render_, and mis-homed:**

- Rank labels — `rankLabels` is defined **inside** `Stream/RankingsOverlay.tsx` (not a util), so
  the tie-`=` logic can't be reused; the `RankBadge` work extracts it to a util first (§6, §8).

**Duplicated today (the work-list):**

- **Time formatting — 3 implementations.** `time.ts:formatMs` (canonical, DNF-aware) vs
  `Speedline/Stopwatch.tsx` `formatTime` (reimplements `M:SS.CC` inline, **no DNF**) vs
  `Freestyle/Countdown.tsx` `formatClock` (own `mm:ss`/`hh:mm:ss` + own `pad`).
- **The broadcast "protection halo" text-shadow** — the same 6-line `rgba(51,60,78,x)` stack copied
  verbatim into `Stopwatch.tsx`, `Countdown.tsx`, and a 4-line subset in `FreestyleTimerDisplay.tsx`;
  `SpeedlineTimerDisplay.tsx` uses a _different_ one-off. (The `textShadow:'none'` cancel is itself
  copied 4+ times.) → a `overlayTextShadow` token or a `<BroadcastText>` primitive.
- **`refVw`/`refVh`** (1920/1080 → vw/vh) copied verbatim into `Competitor`, `VsOverlay`,
  `RankingsOverlay`; while `WinnerOverlay` and `RoundsSummaryOverlay` inconsistently
  use fixed `rem`. → a shared `app/util/overlayScale.ts` + a scaling primitive.
- **Athlete name split — 3 copies.** Canonical `AthleteName.tsx`, reimplemented inline in
  `AthleteCard.tsx` (for `cqh` sizing) and `CompactAthleteCard.tsx`.
- **Flag/country — 2 parallel components + an inline dual-flag row.** `components/CountryFlag.tsx`
  (MUI) vs `Stream/FlagBlock.tsx` (CSS-bg); `PlayoffBracket.tsx` hand-rolls its own dual-nation row.
  (They _do_ correctly share `toAlpha2`.)
- **Plate chrome (fill + stroke + winner ring)** re-declared inline in `PlayoffBracket.tsx`,
  `RankingsOverlay.tsx`, `AthleteNameStrip.tsx`; the winner-edge ternary
  (`isWinner ? race.go : overlay.stroke`) duplicated across 3+ files. → a `<Plate>` primitive.
- **Numeral typography** (`fonts.numerals` + `tabular-nums`) repeated inline via `sx` in **8 files**.
- **Corner status badges** — `ConnectingBadge`/`ConnectionLostBadge`/`AudioMutedBadge` repeat the
  same badge chrome. → a shared `<CornerBadge>`.
- **Display-caps headings** re-declared inline in `VsOverlay`, `WinnerOverlay`,
  `RoundsSummaryOverlay`.

**The two token-access styles** (object import vs `var(--tl-*)` string) are used interchangeably for
the same token — the inconsistency §5 proposes a convention for.

**Enforcement gap:** ESLint has no anti-hex / anti-off-token rule; no stylelint anywhere. The
DESIGN_SYSTEM's hex ban and the `.numerals` class are documentation, not checks.

---

## 8. When to promote a pattern to a shared component (and when NOT to)

The hardest judgment in this layer is _timing_. The literature is unusually unanimous: **premature
abstraction is worse than duplication.**

- Sandi Metz — **"the wrong abstraction"**: genericizing too early tends to produce _bad_
  abstractions; tolerating duplication for a while beats premature extraction. [Erikson citing Metz]
- Dan Abramov — **"The Wet Codebase"**: the same warning, canonized in the React community.
  [cited in prop-explosion post]
- Gall's Law (via Frost) — start with the simplest thing that works; add layers (recipes, smart
  components) **only when a concrete need appears**, never by default. [Frost]

**A working promotion rule for this repo** (pattern → shared component):

1. **Rule of three.** The concept is rendered the same way in **≥3 places**, or **≥2 places across
   different surfaces** (e.g. admin + overlay). Two copies in one file is not yet a component.
2. **The variation is skin-deep.** The instances differ only in token-selected dimensions (size,
   shadow policy, chroma vs solid bg) — not in structure or behavior. If they diverge structurally,
   they're different concepts; don't force one component.
3. **A wrong render is a visible bug.** Concepts the broadcast sees (names, times, plates, ranks)
   earn a component earlier than internal admin chrome, because inconsistency there is _on air_.
4. **Formatting first, chrome second.** Extract the pure formatter (`app/util`) before the
   presentational wrapper; the util is always worth it, the wrapper only past the rule of three.

**Recipes stay recipes** until they meet the bar. `VsOverlay` composing `Competitor` + `ElapsedTime`
is a recipe — it should _not_ itself become a reusable component just because it exists. Only when a
second surface needs the same composition does it graduate. [Frost: recipes graduate to core]

**Signs you're over-abstracting** (stop): a component grows a `variant` enum with >4 members that
share little style; props appear that only one call site sets; you're threading render-props to
inject structure. That's the prop-explosion / Formik-`Input` failure mode — split into compound
parts instead. [prop-explosion]

---

## 9. Recommended architecture for Slackline Timer (synthesis)

1. **Keep the token substrate as-is.** `tokens.ts` + `tokens.css` + parity test is sound; don't
   migrate to `CssVarsProvider` (experimental, and the "you must use `theme.vars`" claim was
   refuted).
2. **Add ESLint enforcement — two clear-cut rules** (§5, §10 Q1/Q6): a `no-restricted-syntax`
   **hex-literal ban** in `.tsx` (allow-listing the token files + `overlayBg.ts`), and the
   **token-access rule** (`var(--tl-*)` only in the non-React seams). Highest leverage, lowest risk.
   Add a targeted "use the component" rule only where a single canonical component exists to point
   at; skip broad/noisy rules.
3. **Build the leaf formatting micro-templates first** (§6): `Numeral`, `ElapsedTime`, `RankBadge`,
   `ResultText`, and unify `AthleteName`/`FlagRow`. These are **configuration**-style (locked down),
   token-only, **no `sx` escape hatch**. Each wraps an existing `app/util` formatter — so they're
   thin, and they collapse the §7 duplication directly.
4. **Extract container primitives second** (§4, hybrid): a polymorphic `Box`/`Text` (use MUI's
   `component` prop, keep the polymorphic surface tiny), a `<Plate>` (fill/stroke/winner-ring), a
   `<CornerBadge>`, and `app/util/overlayScale.ts`. These are **composition/slot**-style so they
   flex across surfaces via a `context` prop, using MUI theme **`variants`** for light skinning only
   — heavier differences stay in the wrapper (MUI: theme isn't tree-shakable).
5. **Leave recipes as recipes.** `VsOverlay`, `RankingsOverlay`, admin tables compose the above;
   they graduate to shared components only on the rule of three (§8).
6. **Mirror the Stately/Aria/Spectrum seam we already have** (§4): pure logic in `app/util` + hooks,
   rendering per surface. Don't let formatting leak back into components.

Net effect: the same "render an X" decision is made once; admin, control, and broadcast all pull the
same leaf; the overlay-specific dimensions (scale, chroma, shadow) are variant props, not copied
code; and a raw hex or an ad-hoc time format becomes a lint failure instead of a review catch.

---

## 10. Resolved decisions

The seven questions below were open at first draft; all are now decided, promoted to
[`decisions.md`](../decisions.md) **ADR 0034**, and **built** — the token/hex lint rules,
`overlayScale.ts`, and the braid-strict leaves (`AthleteName` with its `sizing` prop, `Plate`,
`ElapsedTime`) all shipped. They are kept here as the reasoning behind that ruling; the ADR is
the binding record.

1. **Token-access convention → adopt AND enforce with a lint rule.** "Theme/`colors` inside React,
   `var(--tl-*)` only in non-React CSS/SVG/canvas" is a rule, not a suggestion (§5). It gets its own
   ESLint check (a `no-restricted-syntax` on `var(--tl-` inside `.tsx` outside the allow-listed
   non-React seams), alongside the hex ban.
2. **`context` prop vocabulary → `"admin" | "control" | "broadcast"`.** No finer split. A
   `overlay-solid`/`overlay-chroma` distinction would only exist to toggle the shadow/stroke
   "protection halo" for chroma legibility — but that is already knowable at runtime from `?bg=`
   via `overlayBg.ts` (`isChromaBackground()`), so a `broadcast` component reads it from there
   instead of forking the enum. The finer variant buys nothing; keep the three-value enum.
3. **No `sx` on templated concepts → forbid on leaves, allow on containers.** Leaf micro-templates
   (`Numeral`, `ElapsedTime`, `AthleteName`, `RankBadge`, `FlagRow`, `ResultText`) do **not** accept
   `sx`/`style`/`className` — Braid-strict, so gaps surface as new variants instead of local
   overrides. Container primitives (`Plate`, `Box`, overlay shells) **do** accept `sx`, because they
   exist to be composed.
4. **`refVw`/`refVh` scaling → unify on the vw/vh helper.** OBS captures the overlays at HD
   (1920×1080), which is exactly the reference frame the vw/vh math is keyed to, so the helper is
   correct and safe to standardize on. Extract `app/util/overlayScale.ts` and **convert
   `WinnerOverlay` / `RoundsSummaryOverlay` off their fixed-`rem` sizing** onto it.
5. **Component gallery → no (lean, less maintenance).** Don't stand up Storybook/Ladle. Keep the
   existing `doc/dev/design-system/index.html` token reference; extend it to show a component only if
   that's a trivial addition. The standing maintenance of a separate gallery isn't justified yet.
6. **Enforcement scope → clear-cut rules only, no noisy ones.** Ship the two unambiguous rules: the
   **hex-literal ban** and the **token-access rule** (Q1). Add a targeted "use the component" rule
   **only where there is one canonical component to point at** (e.g. flag inline numeral
   `fontFamily` → `<Numeral>`) and it lints cleanly. **Skip** broad/noisy rules (banning all inline
   `textShadow`, heuristic time-format detection) that would fire on false positives — clarity of
   setup over coverage.
7. **`AthleteName` sizing → one component, `sizing` prop (lean).** The three copies share an
   identical first/last split rule and differ only in unit (`cqh` vs fixed). One component with a
   `sizing="fixed" | "cqh"` prop, not a sibling component.

---

## References

Web research below was gathered by a fan-out/verify harness. Claims marked **[verified]** survived
3-vote adversarial verification; others are single-source extractions (directionally reliable, not
independently cross-checked). Two claims were **refuted** and are noted inline in §5.

- **MUI — Theme components** (`defaultProps`/`styleOverrides`/`variants`, slots, tree-shaking note)
  — https://mui.com/material-ui/customization/theme-components/ **[verified]**
- **MUI — CSS theme variables usage** (`CssVarsProvider`, `theme.vars`, plain-CSS `var()`)
  — https://v5.mui.com/material-ui/experimental-api/css-theme-variables/usage/ **[verified;
  scope-refuted overclaims noted §5]**
- **MUI — RFC #27651** (CSS vars: devtools legibility, SSR-flash, per-system prefix)
  — https://github.com/mui/material-ui/issues/27651 **[verified]**
- **Atlassian — `ensure-design-token-usage` ESLint rule**
  — https://atlassian.design/components/eslint-plugin-design-system/ensure-design-token-usage/
  **[verified]**
- **MetaMask — `color-no-hex` ESLint rule**
  — https://github.com/MetaMask/eslint-plugin-design-tokens/blob/main/docs/rules/color-no-hex.md
  **[verified]**
- **Braid (SEEK) — development workflow** (build-from-props, no `className`/`style`, `Box` escape)
  — https://seek-oss.github.io/braid-design-system/guides/development-workflow/ **[verified]**
- **Adobe — Introducing React Spectrum** (Stately/Aria/Spectrum layering, hooks API)
  — https://react-spectrum.adobe.com/blog/introducing-react-spectrum.html **[verified]**
- **React Aria Components** (zero default styling)
  — https://react-spectrum.adobe.com/react-aria/react-aria-components.html **[verified]**
- **Composition vs configuration / prop explosion / slots / flexibility spectrum (Polaris↔MUI) /
  compound components / atomic-design critiques (D'Amato; FSD/CDD alternatives) / Brad Frost
  core-recipe-smart / polymorphic-`as` & Radix `asChild` pitfalls & headless camps / premature
  abstraction (Metz, Abramov)** — multiple single-source extractions from the search corpus; used
  for the §3/§4/§8 reasoning. Directionally reliable; verify before quoting as fact.

_Codebase duplication map (§7) is from a direct survey of `web/src` and is authoritative for this
repo at time of writing._
