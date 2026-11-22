// The page-side recorder for the genie-first-flight probe — a function
// puppeteer installs with evaluateOnNewDocument, before any page script, that
// writes window.__ff: the adapter, rAF frame times, Long Animation Frames,
// timed WebGPU and WebGL calls, three's per-frame work, shader hashes and the
// windows' landing attributes. It also defines window.__ffReplay, which
// compiles each pipeline again from unique source to time it cold.
//
// It runs in the page, so it can import nothing; run.mjs owns when it is
// installed and flightSummary.mjs owns what the numbers mean.

// Everything it records is in page milliseconds (performance.now()).
export const INSTALL = () => {
  const now = () => performance.now()
  const log = { adapter: null, backend: null, frames: [], loaf: [], api: [], three: [], dom: [], shaders: [] }
  window.__ff = log
  const tick = (t) => {
    log.frames.push(t)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      log.loaf.push({
        start: e.startTime,
        duration: e.duration,
        blocking: e.blockingDuration,
        scripts: e.scripts.map((s) => ({ url: s.sourceURL, fn: s.sourceFunctionName, invoker: s.invoker, duration: s.duration })),
      })
    }
  }).observe({ type: 'long-animation-frame', buffered: true })
  const timed = (proto, name, what) => {
    const original = proto?.[name]
    if (!original) return
    proto[name] = function (...args) {
      const start = now()
      const result = original.apply(this, args)
      log.api.push({ what, start, ms: now() - start })
      if (result instanceof Promise) result.then(() => log.api.push({ what: what + ':resolved', start, ms: now() - start }), () => {})
      return result
    }
  }
  if ('GPU' in globalThis) {
    const requestAdapter = GPU.prototype.requestAdapter
    GPU.prototype.requestAdapter = async function (...args) {
      const adapter = await requestAdapter.apply(this, args)
      if (adapter) {
        const i = adapter.info
        log.adapter = { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description, fallback: i.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null }
      }
      return adapter
    }
    // The source's hash says whether a later load asks for the same shader,
    // which is what every GPU-side compile cache is keyed on.
    const createShaderModule = GPUDevice.prototype.createShaderModule
    const nonce = window.__ffShaderNonce
    const codeOf = new WeakMap()
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      const original = descriptor.code ?? ''
      let code = original
      // SHADERS=fresh: an unused local in every entry point makes the source
      // unique to this load, so no compile cache can answer for it.
      if (nonce) {
        code = code.replace(/(@(?:vertex|fragment|compute)[^{]*\{)/g, `$1\n\tlet ff_fresh_${nonce} = ${nonce}u;`)
        descriptor = { ...descriptor, code }
      }
      let hash = 0x811c9dc5
      for (let i = 0; i < original.length; i++) hash = Math.imul(hash ^ original.charCodeAt(i), 0x01000193)
      const entry = { start: now(), hash: (hash >>> 0).toString(16), length: original.length, textures: (original.match(/texture_2d/g) ?? []).length }
      log.shaders.push(entry)
      const module = createShaderModule.call(this, descriptor)
      codeOf.set(module, { code: original, hash: entry.hash, textures: entry.textures })
      return module
    }
    // Three reuses one descriptor object for every pipeline, so each is
    // copied when it is made. The replay below compiles each distinct pipeline
    // again from source made unique, on a worker, one at a time: its own cold
    // compile cost, which a frame trace can only show summed.
    const descriptors = []
    const copy = (d) => ({
      ...d,
      vertex: { ...d.vertex, buffers: d.vertex.buffers?.map((b) => b && { ...b, attributes: [...b.attributes].map((a) => ({ ...a })) }) },
      fragment: d.fragment && { ...d.fragment, targets: [...d.fragment.targets].map((t) => t && { ...t, blend: t.blend && { color: { ...t.blend.color }, alpha: { ...t.blend.alpha } } }) },
      primitive: d.primitive && { ...d.primitive },
      depthStencil: d.depthStencil && { ...d.depthStencil, stencilFront: { ...d.depthStencil.stencilFront }, stencilBack: { ...d.depthStencil.stencilBack } },
      multisample: d.multisample && { ...d.multisample },
    })
    const createRenderPipeline = GPUDevice.prototype.createRenderPipeline
    GPUDevice.prototype.createRenderPipeline = function (descriptor) {
      const vertex = codeOf.get(descriptor.vertex.module)
      const fragment = descriptor.fragment ? codeOf.get(descriptor.fragment.module) : null
      descriptors.push({ device: this, start: now(), vertex, fragment, descriptor: copy(descriptor) })
      return createRenderPipeline.call(this, descriptor)
    }
    window.__ffReplay = async () => {
      const seen = new Set()
      const out = []
      for (const d of descriptors) {
        const id = `${d.vertex?.hash}/${d.fragment?.hash}`
        if (seen.has(id) || !d.vertex) continue
        seen.add(id)
        const fresh = (source) => {
          const salt = 1 + Math.floor(Math.random() * 2 ** 31)
          return d.device.createShaderModule({ code: source.code.replace(/(@(?:vertex|fragment|compute)[^{]*\{)/g, `$1\n\tlet ff_fresh_${salt} = ${salt}u;`) })
        }
        const descriptor = { ...d.descriptor, vertex: { ...d.descriptor.vertex, module: fresh(d.vertex) } }
        if (d.fragment) descriptor.fragment = { ...d.descriptor.fragment, module: fresh(d.fragment) }
        const start = now()
        await d.device.createRenderPipelineAsync(descriptor)
        out.push({ firstAt: d.start, entryPoints: [d.descriptor.vertex.entryPoint, d.descriptor.fragment?.entryPoint].filter(Boolean).join('/'), vertex: d.vertex.hash, fragment: d.fragment?.hash ?? null, textures: d.fragment?.textures ?? 0, coldCompileMs: now() - start })
      }
      return out
    }
    timed(GPUDevice.prototype, 'createShaderModule', 'createShaderModule')
    timed(GPUDevice.prototype, 'createRenderPipeline', 'createRenderPipeline')
    timed(GPUDevice.prototype, 'createRenderPipelineAsync', 'createRenderPipelineAsync')
    timed(GPUQueue.prototype, 'copyExternalImageToTexture', 'copyExternalImageToTexture')
    timed(GPUQueue.prototype, 'writeTexture', 'writeTexture')
  }
  if ('WebGL2RenderingContext' in globalThis) {
    const gl = WebGL2RenderingContext.prototype
    for (const name of ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter', 'texImage2D', 'texSubImage2D']) timed(gl, name, name)
    const getParameter = gl.getParameter
    gl.getParameter = function (p) {
      if (!log.webgl) {
        const ext = this.getExtension('WEBGL_debug_renderer_info')
        log.webgl = ext ? getParameter.call(this, ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
      }
      return getParameter.call(this, p)
    }
  }
  const hook = () => {
    const r = window.__genieRenderer
    if (!r?._nodes || !r._pipelines || !r._textures) {
      setTimeout(hook, 50)
      return
    }
    log.backend = r.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2'
    const wrap = (owner, name, what) => {
      const original = owner[name]
      owner[name] = function (...args) {
        const start = now()
        try {
          return original.apply(this, args)
        } finally {
          const ms = now() - start
          if (ms > 0.05) log.three.push({ what, start, ms })
        }
      }
    }
    wrap(r._nodes, 'getForRender', 'nodes')
    wrap(r._pipelines, 'getForRender', 'pipelines')
    wrap(r._textures, 'updateTexture', 'textures')
    wrap(r, 'render', 'render')
  }
  hook()
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver((records) => {
      for (const m of records) {
        const el = m.target
        if (el.classList.contains('gen-slot') || el.classList.contains('gen-tile')) {
          log.dom.push({ t: now(), win: el.dataset.win, attr: m.attributeName, value: el.getAttribute(m.attributeName) })
        }
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-away', 'data-filled'] })
  })
}
