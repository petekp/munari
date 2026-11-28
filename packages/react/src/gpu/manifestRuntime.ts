// Internal manifest runtime entry for compiled finish manifests under `gpu/finishes/`.
// Avoids circular imports with `./manifest` while exposing `loadLtcTable` and types.

export { loadLtcTable } from './ltc'
export type { MaterialManifest } from './manifest'
