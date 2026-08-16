# anti-slop — the lint rules with teeth

A local oxlint JS plugin, loaded directly from `.oxlintrc.json`
(`jsPlugins` → `./tools/oxlint/anti-slop/index.ts`). `npm run lint`
runs `--deny-warnings`, so every enabled rule is a hard failure. The
first run reported 544 findings; they were paid off, not suppressed.

The rules read for the shapes reached for when a type is inconvenient:
chained assertions, `unknown` parameters, open dictionaries standing in
for known records, runtime `typeof`, module mocking, assertions with no
stated invariant. When one fires, the fix is never to quiet the rule.
**Do not suppress rules, weaken severity, add unsafe casts, or
mechanically launder types to make lint pass.** Prefer, in order:
inference, `as const`, `satisfies`, a named owner contract, and parsing
external input once at its I/O boundary.

Housekeeping: the plugin's own source is in `ignorePatterns` (it never
lints itself) but it **is** typechecked (`tools/tsconfig.json` — the
one dialect divergence is `allowImportingTsExtensions`, because oxlint
loads these files unbundled at the paths written in the imports). A
rule is disabled by *omitting* its key from the `rules` object — there
is no `"off"` entry.

## The rules

- **`no-chained-type-assertions`** — an assertion whose operand is
  itself an assertion (`x as A as B`, through parentheses). The chain
  discards type evidence; keep the original precise type, or parse
  untrusted input at its boundary before narrowing. Chains that are
  entirely `as const` are allowed.
- **`no-conditional-empty-object-spread`** —
  `{ ...(cond ? {} : value) }`. It hides property omission behind an
  empty object; build the object in separate statements and add the
  property only when present.
- **`no-known-value-widening`** — a value with known evidence (a
  literal, object/array/function expression, or a `const` traced to
  one) flowing into an explicit `unknown`, bare `object`, anonymous
  object type, or open dictionary (`Record`, index signature)
  annotation — on bindings, properties, returns, and assertions. Keep
  inference, validate with `satisfies`, or use a named owner contract.
  Carve-out: `{}` initializing a dictionary-typed accumulator.
- **`no-module-mocking`** — `vi.mock` / `vi.doMock` /
  `jest.mock` / `unstable_mockModule`, anywhere, test files included
  (`tests/boundary.test.ts` greps for the same thing). Use dependency
  injection through a real interface or a faithful test implementation.
- **`no-object-parameters`** — a parameter typed bare `object`
  (directly, as a union member, or through a one-hop alias). Accept a
  named owner type; parse external input before the call.
- **`no-reflect-apply` / `no-reflect-get`** — global `Reflect.apply` /
  `Reflect.get`. Use a typed call / typed property access; model
  dynamic dispatch behind a named interface.
- **`no-runtime-typeof`** — every `typeof` expression. A `typeof`
  check narrows a representation without establishing its contract;
  parse input at its I/O boundary, then branch on the domain value.
  (The rule has an opt-in escape for user-defined type guards; this
  repo does not enable it.)
- **`no-unknown-parameters`** — a parameter annotated exactly
  `unknown`. Accept a named domain type; run the parser at the
  boundary before the call. Carve-out: a parameter named `cause`
  (error-cause enrichment).
- **`no-unknown-returns`** — a return type resolving to `unknown`
  (directly, via a union member, a one-hop alias, or
  `Promise<unknown>`). Parse the value before returning it and name
  the type.
- **`no-unknown-type-aliases`** — a top-level alias that resolves to
  `unknown`. Keep `unknown` explicit at the parsing boundary or on a
  `cause` field; otherwise use the parsed owner type. Generic aliases
  are skipped.
- **`no-unsafe-dictionary-type`** — a dictionary whose value type
  resolves to `unknown`, `any`, bare `object`, or an empty object —
  through `Record`, index signatures, mapped types, `Pick`/`Omit`, and
  `Readonly`/`Partial`/`Required`/`NonNullable` wrappers. Use an
  owner- or schema-derived value type; parse external payloads before
  insertion.
- **`no-widen-then-assert`** — a `const` with known evidence declared
  at a broad type (or asserted broad at birth) and later asserted back
  to something narrower in the same function. Keep the precise type
  from initialization through use; parse boundary input once.
- **`require-safety-comment-for-type-assertion`** — any non-`const`
  assertion without a `SAFETY:` comment nearby. The match is
  case-sensitive (`SAFETY` then a colon), and the comment may sit
  directly above the assertion or above its enclosing statement — one
  comment above a `const x = …` covers assertions anywhere in that
  initializer. State the checked invariant, not a hand-wave: what is
  known, and why it holds here.

## The one that is off

**`no-shape-in-symbol-names`** ships in `rules/` and is registered in
`index.ts`, but its key is deliberately absent from `.oxlintrc.json`.
It bans the case-insensitive substring "shape" in every identifier and
reads property identifiers too, so `THREE.Shape` and
`THREE.ShapeGeometry` trip it and no alias escapes — and replacing
those means hand-writing a triangulator and a bevel generator, which
moves pixels this repo holds perceptual floors on. The rule stays for
repos that can afford it; this one cannot.
