# Developing munari

## Repo shape

| path | what it is |
| --- | --- |
| `packages/core` | the renderer-agnostic core; no dependencies, bundled into the package |
| `packages/react` | the `@petepetrash/munari` package: React/three components over core |
| `registry/` | source you copy into your project (nothing published) |
| `apps/lab` | the demo and development app |
| `instruments/` | browser probes and CI gates |
| `tests/conformance/` | the test suites that define core's behavior |

Dependencies point one way: apps depend on `packages/react`, which
depends on `packages/core`. `tests/boundary.test.ts` checks the actual
imports.

See [AGENTS.md](https://github.com/petekp/munari/blob/v0.4.1/AGENTS.md) for the working rules, [docs/decisions.md](https://github.com/petekp/munari/blob/v0.4.1/docs/decisions.md)
for the numbered design decisions, [docs/platform.md](https://github.com/petekp/munari/blob/v0.4.1/docs/platform.md) for what
the platform is measured to do, [docs/authoring.md](https://github.com/petekp/munari/blob/v0.4.1/docs/authoring.md) for how
to write markup a Surface can draw, and [docs/focus.md](https://github.com/petekp/munari/blob/v0.4.1/docs/focus.md) for the
focus and spatial-navigation contract.

## Development

```sh
npm ci
npm run lab              # Vite + a compatible local Chrome
npm run dev              # Vite only
npm run typecheck
npm test
npm run lint
npm run gate:idle-zero   # browser gate: idle Surfaces cost 0 paints/s
```

[package.json](https://github.com/petekp/munari/blob/v0.4.1/package.json) lists available gate commands;
[the CI workflow](https://github.com/petekp/munari/blob/v0.4.1/.github/workflows/ci.yml) selects the gates run on each push.
[The instrument guide](https://github.com/petekp/munari/blob/v0.4.1/instruments/README.md) gives each check's scope and
limits. Run GPU gates in series. A capability skip is not a passing behavior
check; use `STRICT_CAPABILITY=1` where HTML-in-canvas must be present.

The repo uses Node 24 and npm 11. The local launcher (`npm run lab`) starts Vite, opens an
isolated Chrome, and stops the server when you close that Chrome window.
Set `CHROME_PATH` if Chrome is installed somewhere unusual. The launcher still
passes `--enable-features=CanvasDrawElement`; Chrome 157 and later do not need
that flag. To use your existing browser, run `npm run dev` to start only Vite,
then open its URL in Chrome 157 or later.

`npm run build` stages the package with core bundled in and peers left
external. The staged package includes the canonical root README, license,
changelog, `llms.txt`, and Munari skill. To use a checkout's API in another
project, run the build and install the staged `packages/react/dist` directory
in that project. To publish, inspect the staged package, then publish from its
directory:

```sh
npm run build
npm pack --dry-run packages/react/dist
npm publish packages/react/dist
```
