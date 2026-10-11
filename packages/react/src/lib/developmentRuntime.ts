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
// and preparation-wait warnings did not. None of them read `NODE_ENV` in the
// literal form that webpack and Next substitute in a browser bundle.
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
  // SAFETY: `import.meta.env` is the host's, not the language's. It exists
  // under Vite and nowhere else, so its shape is described here and every
  // member is optional because absence is the normal answer.
  const metaEnvironment = (
    import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } }
  ).env
  return resolveDevelopment(metaEnvironment?.DEV, nodeEnvironment())
}

function nodeEnvironment(): string | undefined {
  // The exact text `process.env.NODE_ENV`, because that is what webpack,
  // Next and Vite substitute; an optional-chained read is left alone and
  // finds no `process` in a browser bundle. The catch is a browser with no
  // bundler, where `process` does not exist.
  try {
    return process.env.NODE_ENV
  } catch {
    return undefined
  }
}
