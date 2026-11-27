# @petepetrash/munari-cli

CLI and AOT TypeGPU compiler for Munari Materials and registry tools.

## Commands

- `munari init` — create `munari.json` configuring where owned materials and tools are written.
- `munari list` — list materials (`flight-card`, `fisheye-lens`, `foil`, `vignette`, `tilt-shadow`, `glass-refract`) and tools (`finishes`, `glass`, `focus-orbit`).
- `munari add <names...>` — copy owned `*.material.ts` + compiled `*.material.gen.ts` (or `--no-source` for compiled manifests only) into your project.
- `munari compile [files...]` — compile TypeGPU `*.material.ts` sources into zero-dependency `*.material.gen.ts` manifests and verify every uniform packer byte-for-byte against `typed-binary`.
- `munari check [files...]` — verify generated `*.material.gen.ts` files match their `*.material.ts` sources.
