# no-tautological-absence lint plugin

Custom oxlint rule loaded from `.oxlintrc.json` (`jsPlugins` ->
`./tools/oxlint/no-tautological-absence/index.mjs`).

## Purpose

Flags `.not.toContain(...)`, `.not.toContainText(...)`, and
`.not.toHaveTextContent(...)` assertions in `*.test.*` / `*.spec.*` files whose
expected instructional copy string no longer exists anywhere in live (uncommented)
code or positive assertions across the repository.

When UI copy is removed or rewritten, a lone negative assertion against the
deleted phrase passes forever regardless of whether the surrounding behavior
works. Either test a live positive state transition (paired with a matching
positive `.toContain(...)` assertion) or remove the obsolete negative check.
