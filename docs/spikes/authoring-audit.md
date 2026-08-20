# Spike: dev-mode authoring audit (untwinned `:hover` detection)

Measured 2026-08-19, Chrome, via a disposable page served from the session
scratchpad (5,211 rules, 211 mentioning `:hover`, 300-element subtree —
Tailwind scale). The apparatus is deleted; this report is the artifact.

**Questions asked:**

1. Can CSSOM enumerate every hover-mentioning rule a subtree is subject to
   (`@media`, `@layer`, native nesting, `adoptedStyleSheets`) while skipping
   cross-origin sheets without throwing?
2. Does "stamp `data-hover`, re-run `matches(selectorText)`, fall back to a
   collected twin-rule list" correctly separate twinned from untwinned rules
   across real-world selector forms?
3. Is the audit cheap enough to run per source mount in development?
4. Do the secondary checks (`mask-image` scan, root-animation via
   `getAnimations`, zero-size root) detect their positives, and at what cost?

**Verdict:** viable — every question came back yes; the kill criterion
(misclassifying Tailwind's compiled custom-variant form) was not hit.

## What we learned

- **Enumeration: yes.** Recursing `cssRules` through grouping rules found
  hover rules inside `@media` and `@layer`; `document.adoptedStyleSheets`
  needs explicit inclusion but then behaves identically. A cross-origin
  `<link>` (unpkg normalize.css) throws only on `cssRules` access — one
  try/catch per sheet skips it cleanly (recorded as `skippedSheets: 1`).
- **Classification: yes, with two recorded edges.** Correctly warned on:
  plain `.x:hover`, hover inside `@media`/`@layer`, an adopted-sheet rule,
  `:is(.a, .b):hover` (comma inside `:is` — safe because the check never
  splits selectors on commas; it queries the full `selectorText`), and a
  nested `&:hover` after resolving `&` against the parent rule's selector.
  Correctly stayed silent on all three twin forms: same-rule selector list,
  Tailwind's compiled `.x:is(:hover, [data-hover])`, and a twin written as a
  separate rule.
- **Cost: trivial.** Cold run 5.2ms collect + 0.8ms scan; warm run
  1.6ms + 0.6ms. The rule-major shape (querySelectorAll per stripped hover
  selector, then stamp-and-match per hit) is what keeps the scan sub-ms.
- **Secondary checks: yes.** A `mask-image` on one descendant of 300 was
  found in 0.5ms via a computed-style walk. A Web Animations animation on
  the root itself shows in `root.getAnimations({subtree: false})`. Both
  positives fired; both were silent on clean content.

## What surprised us

- **Native CSS nesting reports `selectorText` as `&:hover`**, which
  `matches()` cannot take. One level of `&` substitution with the parent
  rule's selector was enough here, but deep nesting needs a real resolver —
  or `CSSStyleRule.selectorText` may be joined by future CSSOM work.
- **Naive `:hover` stripping is the only parser hazard found.**
  `.x:not(:hover)` strips to `.x:not()`, a syntax error. The try/catch
  skips it (no false warning), which is acceptable: `:not(:hover)` styles
  the *unhovered* state and is rare. No other crafted form broke.
- **`:has(> .kid:hover)` warns correctly but can't see its twin.** The
  stamp lands on the element the stripped selector matches (the container),
  while a real forwarder stamps the target and its ancestors — so a twin
  written as `:has(> .kid[data-hover])` would still warn. False positive
  risk on twinned-`:has` only; stamping matched descendants too would close
  it if it ever matters.

## Still unknown

- `:active`/`[data-active]` was not exercised — same mechanism, same code
  path, no reason to expect a difference, but unmeasured.
- Behavior against the lab's real Tailwind output (vs. the synthetic
  rules mimicking it) — worth one run against `apps/lab` when building the
  real thing.
- Whether distinguishing *transform/opacity* animations on the root (the
  actual authoring ban) from benign ones needs `effect.getKeyframes()`
  inspection — API exists, unmeasured.

## Recommended approach

- Dev-only module (`import.meta.env.DEV`-guarded or a separate entry), run
  once per source subtree mount, warn-once per (rule, subtree).
- Rule-major scan: collect hover/twin rules once per document (cache,
  invalidate on a `document.styleSheets` length change), then per Surface
  query the stripped selector and stamp-test the hits.
- Report each finding with the selector, the sheet href, and a link to
  `docs/authoring.md` — the audit is the doc's enforcement arm.
- Fold in the cheap checks in the same pass: `mask-image` in subtree,
  zero-size root, animation on the root element itself.
- Skip-with-note on selector parse errors; never guess.

## Cost signals

Small: one new dev-only module (~150 lines by the apparatus's shape), a
call site where a source registers, no dependencies, no API surface beyond
maybe an opt-out. The hard part is already de-risked (selector handling);
what remains is warn-once bookkeeping and wiring.
