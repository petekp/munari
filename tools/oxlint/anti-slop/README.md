# anti-slop lint rules

Custom oxlint rules, loaded from `.oxlintrc.json` (`jsPlugins` →
`./tools/oxlint/anti-slop/index.ts`). `npm run lint` runs with
`--deny-warnings`, so every enabled rule is an error.

The rules reject patterns that discard or hide type information:
chained assertions, `unknown` parameters, open dictionaries where the
keys are known, runtime `typeof`, module mocking, assertions with no
stated reason. When one fires, fix the type problem. Do not suppress
the rule, weaken its severity, or add a cast to quiet it. Prefer, in
order: inference, `as const`, `satisfies`, a named type, and parsing
external input once, where it enters the program.

Housekeeping: the plugin's own source is in `ignorePatterns` (it does
not lint itself) but `tools/tsconfig.json` typechecks it; the one
compiler-option difference is `allowImportingTsExtensions`, because
oxlint loads these files unbundled at the paths written in the
imports. Disable a rule by omitting its key from the `rules` object;
there is no `"off"` entry.

## The rules

- **`no-chained-type-assertions`**: an assertion whose operand is
  itself an assertion (`x as A as B`, through parentheses). The chain
  discards type information; keep the original precise type, or parse
  untrusted input where it enters before narrowing. Chains that are
  wholly `as const` are allowed.
- **`no-conditional-empty-object-spread`**:
  `{ ...(cond ? {} : value) }`. It hides property omission behind an
  empty object; build the object in separate statements and add the
  property only when present.
- **`no-known-value-widening`**: a value with a known shape (a
  literal, object/array/function expression, or a `const` traced to
  one) flowing into an explicit `unknown`, bare `object`, anonymous
  object type, or open dictionary (`Record`, index signature)
  annotation, on bindings, properties, returns, and assertions. Keep
  inference, validate with `satisfies`, or use a named type.
  Carve-out: `{}` initializing a dictionary-typed accumulator.
- **`no-module-mocking`**: `vi.mock` / `vi.doMock` /
  `jest.mock` / `unstable_mockModule`, anywhere, test files included
  (`tests/boundary.test.ts` greps for the same thing). Use dependency
  injection through a real interface or a faithful test
  implementation.
- **`no-object-parameters`**: a parameter typed bare `object`
  (directly, as a union member, or through a one-hop alias). Accept a
  named type; parse external input before the call.
- **`no-reflect-apply` / `no-reflect-get`**: global `Reflect.apply` /
  `Reflect.get`. Use a typed call / typed property access; model
  dynamic dispatch behind a named interface.
- **`no-runtime-typeof`**: every `typeof` expression. A `typeof`
  check narrows a value without establishing what it is; parse input
  where it enters the program, then branch on the parsed value. (The
  rule has an opt-in escape for user-defined type guards; this repo
  does not enable it.)
- **`no-unknown-parameters`**: a parameter annotated exactly
  `unknown`. Accept a named type; run the parser before the call.
  Carve-out: a parameter named `cause` (error-cause enrichment).
- **`no-unknown-returns`**: a return type resolving to `unknown`
  (directly, via a union member, a one-hop alias, or
  `Promise<unknown>`). Parse the value before returning it and name
  the type.
- **`no-unknown-type-aliases`**: a top-level alias that resolves to
  `unknown`. Keep `unknown` explicit at the parsing boundary or on a
  `cause` field; otherwise use the parsed type. Generic aliases are
  skipped.
- **`no-unsafe-dictionary-type`**: a dictionary whose value type
  resolves to `unknown`, `any`, bare `object`, or an empty object,
  through `Record`, index signatures, mapped types, `Pick`/`Omit`, and
  `Readonly`/`Partial`/`Required`/`NonNullable` wrappers. Use a named
  or schema-derived value type; parse external payloads before
  insertion.
- **`no-widen-then-assert`**: a `const` declared at a broad type (or
  asserted broad at birth) and later asserted back to something
  narrower in the same function. Keep the precise type from
  initialization through use; parse boundary input once.
- **`require-safety-comment-for-type-assertion`**: any non-`const`
  assertion without a `SAFETY:` comment nearby. The match is
  case-sensitive (`SAFETY` then a colon), and the comment may sit
  above the assertion or above its enclosing statement; one comment
  above a `const x = …` covers assertions anywhere in that
  initializer. State the checked invariant: what is known, and why it
  holds here.

## Disabled: no-shape-in-symbol-names

The rule ships in `rules/` and is registered in `index.ts`, but its
key is left out of `.oxlintrc.json`. It bans the substring "shape"
(case-insensitive) in every identifier, including property names, so
`THREE.Shape` and `THREE.ShapeGeometry` trip it and no alias escapes.
Replacing those means hand-writing a triangulator and a bevel
generator. That trade fails here; the rule stays available for repos
where it holds.
