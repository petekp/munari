// Loading recorder — what each step between navigation and a fully drawn
// effect costs, written into window.__ld in page milliseconds.
//
// Installed with evaluateOnNewDocument, before any page script. It wraps the
// WebGPU entry points (adapter, device, shader module and pipeline creation,
// uploads), three's renderer once init() assigns its managers (node builds,
// pipeline lookups, renders by target), html-in-canvas onpaint, image decode
// and fetch, and reads Performance Observer entries. A wrapped call's time is
// when JavaScript issued it: createRenderPipeline returns at once in the page
// and its compile runs in the GPU process, so its cost shows as a frame gap,
// not as a long call.
//
// With cfg.nonce set, every WGSL entry point gains an unused local holding
// the nonce, so no shader cache from an earlier profile matches and the same
// profile's second load can reuse the first's.
//
// Ownership: this file only records; run.mjs drives loads and summarize.mjs
// does the arithmetic.
export const INSTALL = (cfg) => {
  const now = () => performance.now()
  const L = (window.__ld = { cfg, marks: [], gpu: [], pipes: [], three: [], renders: [], frames: [], loaf: [], shifts: [], lcp: [], paints: [], fonts: [], sources: [], decode: [], fetches: [], onpaint: [], uploads: [], attrs: [], adapter: null, counts: { shaderModules: 0, shaderChars: 0, submits: 0 } })
  performance.mark('ld:install')
  const tick = (t) => { L.frames.push(t); pollSources(t); requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const seen = new Map()
  function pollSources(t) {
    const stats = window.__munari?.stats?.()
    if (!stats) return
    for (const s of stats) {
      const prev = seen.get(s.label) ?? 0
      if (s.paints > 0 && prev === 0) L.sources.push({ label: s.label, t, engine: s.engine })
      seen.set(s.label, s.paints)
    }
  }
  const observe = (type, fn) => { try { new PerformanceObserver((l) => { for (const e of l.getEntries()) fn(e) }).observe({ type, buffered: true }) } catch {} }
  observe('long-animation-frame', (e) => L.loaf.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration, scripts: e.scripts.slice(0, 4).map((s) => ({ url: (s.sourceURL || '').split('/').pop(), fn: s.sourceFunctionName, invoker: s.invoker, type: s.invokerType, d: s.duration })) }))
  observe('layout-shift', (e) => L.shifts.push({ t: e.startTime, v: e.value, input: e.hadRecentInput, sources: (e.sources || []).slice(0, 3).map((s) => (s.node ? [s.node, s.node.parentElement, s.node.parentElement?.parentElement].filter(Boolean).map((n) => n.nodeName + '.' + String(n.className || '').split(' ')[0]).join('<') : '?') + ' ' + JSON.stringify([s.previousRect?.y, s.currentRect?.y, s.previousRect?.height, s.currentRect?.height])) }))
  observe('largest-contentful-paint', (e) => L.lcp.push({ t: e.startTime, size: e.size, el: e.element ? e.element.tagName + '.' + String(e.element.className || '').slice(0, 40) : null }))
  observe('paint', (e) => L.paints.push({ name: e.name, t: e.startTime }))
  observe('mark', (e) => L.marks.push({ name: e.name, t: e.startTime }))
  document.fonts.addEventListener('loadingdone', (e) => L.fonts.push({ t: now(), what: 'done', faces: e.fontfaces.map((f) => f.family + ' ' + f.weight) }))
  document.fonts.addEventListener('loading', () => L.fonts.push({ t: now(), what: 'loading' }))
  document.fonts.ready.then(() => L.fonts.push({ t: now(), what: 'ready' }))
  const wrapAsync = (proto, name, what, extra) => {
    const original = proto?.[name]
    if (!original) return
    proto[name] = function (...args) {
      const start = now()
      const result = original.apply(this, args)
      const entry = { what, start, ms: null }
      if (extra) Object.assign(entry, extra(args))
      L.gpu.push(entry)
      Promise.resolve(result).then((v) => { entry.ms = now() - start; if (what === 'requestAdapter' && v) { const i = v.info; L.adapter = { vendor: i.vendor, architecture: i.architecture, description: i.description, fallback: i.isFallbackAdapter ?? null } } }, () => { entry.ms = now() - start; entry.failed = true })
      return result
    }
  }
  const wrapSync = (proto, name, fn) => {
    const original = proto?.[name]
    if (!original) return
    proto[name] = function (...args) {
      const start = now()
      try { return original.apply(this, args) } finally { fn(now() - start, start, args, this) }
    }
  }
  if ('GPU' in globalThis) {
    wrapAsync(GPU.prototype, 'requestAdapter', 'requestAdapter')
    wrapAsync(GPUAdapter.prototype, 'requestDevice', 'requestDevice')
    wrapSync(GPUCanvasContext.prototype, 'configure', (ms, start) => L.gpu.push({ what: 'configure', start, ms }))
    const nonce = cfg.nonce
    const modHash = new WeakMap()
    const describe = (d) => d && ({ vs: modHash.get(d.vertex?.module), fs: modHash.get(d.fragment?.module), fmt: d.fragment?.targets?.map((t) => t?.format + (t?.blend ? '+b' : '')).join(','), samples: d.multisample?.count ?? 1, depth: d.depthStencil?.format, topo: d.primitive?.topology, cull: d.primitive?.cullMode, buffers: d.vertex?.buffers?.length })
    L.describe = true
    const createShaderModule = GPUDevice.prototype.createShaderModule
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      let code = descriptor.code ?? ''
      L.counts.shaderModules++
      L.counts.shaderChars += code.length
      if (nonce) { code = code.replace(/(@(?:vertex|fragment|compute)[^{]*\{)/g, '$1\n\tlet ld_fresh_' + nonce + ' = ' + nonce + 'u;'); descriptor = { ...descriptor, code } }
      const module = createShaderModule.call(this, descriptor)
      let h = 2166136261
      for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 16777619)
      modHash.set(module, (h >>> 0).toString(36))
      if (cfg.keepCode) (L.code ??= {})[(h >>> 0).toString(36)] = code
      return module
    }
    wrapSync(GPUDevice.prototype, 'createRenderPipeline', (ms, start, [d]) => L.pipes.push({ kind: 'sync', start, ms, label: d?.label, desc: describe(d) }))
    wrapSync(GPUDevice.prototype, 'createComputePipeline', (ms, start, [d]) => L.pipes.push({ kind: 'sync-compute', start, ms, label: d?.label }))
    for (const [name, kind] of [['createRenderPipelineAsync', 'async'], ['createComputePipelineAsync', 'async-compute']]) {
      const original = GPUDevice.prototype[name]
      GPUDevice.prototype[name] = function (d) {
        const start = now()
        const entry = { kind, start, ms: null, label: d?.label, desc: name === 'createRenderPipelineAsync' ? describe(d) : undefined }
        L.pipes.push(entry)
        const p = original.call(this, d)
        p.then(() => { entry.ms = now() - start }, () => { entry.ms = now() - start; entry.failed = true })
        return p
      }
    }
    wrapSync(GPUQueue.prototype, 'copyExternalImageToTexture', (ms, start, [src, , size]) => L.uploads.push({ kind: 'external', start, ms, w: size?.width ?? size?.[0], h: size?.height ?? size?.[1], src: src?.source?.constructor?.name }))
    wrapSync(GPUQueue.prototype, 'writeTexture', (ms, start, [, data, , size]) => L.uploads.push({ kind: 'write', start, ms, bytes: data?.byteLength, w: size?.width ?? size?.[0], h: size?.height ?? size?.[1] }))
    wrapSync(GPUQueue.prototype, 'submit', () => { L.counts.submits++ })
  }
  // HTML-in-canvas: time each onpaint callback the page installs.
  const onpaint = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'onpaint')
  if (onpaint?.set) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'onpaint', {
      configurable: true,
      get() { return onpaint.get.call(this) },
      set(fn) {
        if (!(fn instanceof Function)) return onpaint.set.call(this, fn)
        const canvas = this
        onpaint.set.call(this, function (...args) {
          const start = now()
          try { return fn.apply(this, args) } finally { L.onpaint.push({ start, ms: now() - start, w: canvas.width, h: canvas.height }) }
        })
      },
    })
  }
  // snapDOM: image decodes and font fetches.
  const decode = HTMLImageElement.prototype.decode
  HTMLImageElement.prototype.decode = function () {
    const start = now()
    const entry = { start, ms: null, w: this.width, h: this.height, src: String(this.src).slice(0, 20) }
    L.decode.push(entry)
    const p = decode.call(this)
    p.then(() => { entry.ms = now() - start }, () => { entry.ms = now() - start; entry.failed = true })
    return p
  }
  const fetch0 = globalThis.fetch
  globalThis.fetch = function (input, init) {
    const start = now()
    const url = String(input?.url ?? input)
    const entry = { start, ms: null, url: url.split('/').pop() }
    L.fetches.push(entry)
    const p = fetch0.call(this, input, init)
    p.then(() => { entry.ms = now() - start }, () => { entry.ms = now() - start; entry.failed = true })
    return p
  }
  // three's WebGPURenderer: catch the instance when init() assigns its
  // managers, then time node builds, pipeline lookups, texture updates and
  // renders. Renders are classed by their target.
  const hooked = new WeakSet()
  const hook = (r) => {
    if (hooked.has(r) || !r._nodes || !r._pipelines || !r._textures) return
    hooked.add(r)
    L.backend = r.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2'
    const wrap = (owner, name, what, detail) => {
      const original = owner[name]
      owner[name] = function (...args) {
        const start = now()
        try { return original.apply(this, args) } finally {
          const ms = now() - start
          if (ms > 0.2) {
            const entry = { what, start, ms }
            if (detail) Object.assign(entry, detail(args))
            L.three.push(entry)
          }
        }
      }
    }
    wrap(r._nodes, 'getForRender', 'nodes', ([ro]) => ({ material: ro?.material?.type, name: ro?.material?.name || undefined }))
    wrap(r._pipelines, 'getForRender', 'pipelines')
    wrap(r._textures, 'updateTexture', 'textures')
    const render = r.render
    r.render = function (scene, camera) {
      const target = this.getRenderTarget?.()
      const start = now()
      try { return render.call(this, scene, camera) } finally {
        const ms = now() - start
        L.renders.push({ start, ms, target: target ? (target.texture?.name || 'target') + ' ' + target.width + 'x' + target.height : 'screen' })
      }
    }
  }
  const trap = (prop) => {
    Object.defineProperty(Object.prototype, prop, {
      configurable: true,
      set(v) {
        let value = v
        const owner = this
        Object.defineProperty(owner, prop, { configurable: true, enumerable: true, get: () => value, set: (n) => { value = n; if (n && owner.render instanceof Function && owner.backend) queueMicrotask(() => hook(owner)) } })
        if (v && owner.render instanceof Function && owner.backend) queueMicrotask(() => hook(owner))
      },
    })
  }
  trap('_textures')
  new MutationObserver((records) => { for (const r of records) if (r.target === document.documentElement) L.attrs.push({ t: now(), attr: r.attributeName, value: document.documentElement.getAttribute(r.attributeName) }) })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ['data-opening', 'data-page-ready'] })
}
