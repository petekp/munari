// Idle-mode transform — the Vite plugin that sets each SurfaceCanvas's frame
// loop from `__idleRenderMode` at serve time and turns on timestamp queries,
// and the dev server that applies it. The package source is not edited.

import path from 'node:path'
import { createServer } from 'vite'
import { repoRoot, labRoot, OUT } from './probeConfig.mjs'

export let transformed = 0
export const idleModeTransform = {
  name: 'idle-render-mode',
  enforce: 'pre',
  transform(source, id) {
    const file = id.split('?')[0]
    // The Light scene draws with its own WebGPURenderers, not a SurfaceCanvas.
    if (file.includes('/scenes/light/') && source.includes('new WebGPURenderer(')) {
      transformed++
      return source.replaceAll('new WebGPURenderer(', 'new IdleRenderTrackedRenderer(') +
        '\nconst IdleRenderTrackedRenderer = class extends WebGPURenderer {\n' +
        '  constructor(parameters) {\n' +
        '    super({ ...parameters, trackTimestamp: globalThis.__idleRenderTimestamps === true })\n' +
        '    ;(globalThis.__idleRenderers ??= []).push(this)\n' +
        '  }\n' +
        '}\n'
    }
    if (!file.endsWith('/primitives/surface/SurfaceCanvas.tsx')) return null
    const construct = 'const renderer = new WebGPURenderer({ antialias, alpha, ...parameters, powerPreference, requiredLimits, canvas })'
    if (source.split(construct).length !== 2) throw new Error('idle-render: WebGPURenderer construction moved')
    source = source.replace(construct, 'const renderer = new WebGPURenderer({ antialias, alpha, ...parameters, powerPreference, requiredLimits, canvas, trackTimestamp: (globalThis as { __idleRenderTimestamps?: boolean }).__idleRenderTimestamps === true }); ((globalThis as { __idleRenderers?: WebGPURenderer[] }).__idleRenderers ??= []).push(renderer)')
    const signature = 'export function SurfaceCanvas({'
    const at = source.indexOf(signature)
    const param = source.indexOf('\n  frameloop,\n', at)
    const body = source.indexOf('}: SurfaceCanvasProps) {\n', at)
    if (at < 0 || param < 0 || body < 0 || source.indexOf(signature, at + 1) >= 0) throw new Error('idle-render: SurfaceCanvas insertion points moved')
    transformed++
    const bodyEnd = body + '}: SurfaceCanvasProps) {\n'.length
    return source.slice(0, param) + '\n  frameloop: authoredFrameloop,\n' + source.slice(param + '\n  frameloop,\n'.length, bodyEnd) +
      '  const frameloop = idleRenderFrameloop(authoredFrameloop)\n' + source.slice(bodyEnd) +
      '\nfunction idleRenderFrameloop(authored: CanvasProps["frameloop"]): CanvasProps["frameloop"] {\n' +
      '  const mode = (globalThis as { __idleRenderMode?: string }).__idleRenderMode\n' +
      '  if (mode === "all-demand") return "demand"\n' +
      '  if (mode === "all-always") return "always"\n' +
      '  if (mode === "default-demand") return authored ?? "demand"\n' +
      '  return authored\n' +
      '}\n'
  },
}

export async function startServer(root, extra = {}) {
  const server = await createServer({
    root,
    configFile: root === labRoot ? path.join(labRoot, 'vite.config.ts') : false,
    cacheDir: path.join(OUT, '.vite-' + path.basename(root)),
    plugins: [idleModeTransform],
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repoRoot] } },
    ...extra,
  })
  await server.listen()
  return { server, url: 'http://127.0.0.1:' + server.httpServer.address().port }
}
