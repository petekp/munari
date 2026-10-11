// Development runtime — whether this host wants Munari's developer
// diagnostics.
//
// The law: an explicit Vite `import.meta.env.DEV` boolean decides. Without
// one, a Node `NODE_ENV` of `development` or `test` is development. Anything
// else, including no flag at all, is quiet.
//
// Found 2026-10-10 by reading, not measured in a host: SurfaceCanvas and the
// wait validation each read only `import.meta.env.DEV`, while FrameSurface
// also read `NODE_ENV`. Under Node with `NODE_ENV=development` the
// presentation warnings printed and the GLSL, tone-mapping, reserved-style
// and preparation-wait warnings did not.
//
// Ownership: this module answers the question once. Each diagnostic decides
// what to print and how often.

export function resolveDevelopment(
  metaDevelopment: boolean | undefined,
  nodeEnvironment: string | undefined,
): boolean {
  if (metaDevelopment !== undefined) return metaDevelopment
  return nodeEnvironment === 'development' || nodeEnvironment === 'test'
}

export function isDevelopmentRuntime(): boolean {
  // SAFETY: both of these are the HOST's, not the language's. `import.meta
  // .env` exists under Vite and nowhere else; `process` exists under Node
  // and nowhere else. The library has to build and run under every host, so
  // each shape is described here instead of imported from one of them, and
  // every member is optional because absence is the normal answer.
  const metaEnvironment = (
    import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } }
  ).env
  // SAFETY: as above, for the Node half.
  const nodeEnvironment = (
    globalThis as typeof globalThis & {
      readonly process?: { readonly env?: { readonly NODE_ENV?: string } }
    }
  ).process?.env?.NODE_ENV
  return resolveDevelopment(metaEnvironment?.DEV, nodeEnvironment)
}
