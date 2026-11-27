// Step 1 WebGPU-only browser claims probe entry.
// Exercises dual-view textures, resize reallocation, premultiplied swapchain
// compositing, async vs blocking pipeline compile, mipmaps, and upload latency.

import {
  measureUploadLatency,
  readAdapterReport,
  runClaim1,
  runClaim3,
  runClaim5,
  setupClaim2Canvases,
  type AdapterReport,
  type Claim1Report,
  type Claim3Report,
  type Claim4Report,
  type Claim5Report,
} from './probeClaims'

export interface ProbeResult {
  readonly ok: boolean
  readonly failure: string | null
  readonly userAgent: string
  readonly adapter: AdapterReport | null
  readonly claim1: Claim1Report | null
  readonly claim2Ready: boolean
  readonly claim3: Claim3Report | null
  readonly claim4: Claim4Report | null
  readonly claim5: Claim5Report | null
  readonly uncapturedErrors: readonly string[]
}

async function runProbe(): Promise<void> {
  const outEl = document.getElementById('probe-out')
  let cleanupClaim2: (() => void) | null = null
  const uncapturedErrors: string[] = []
  try {
    if (!navigator.gpu) throw new Error('navigator.gpu is unavailable')
    const params = new URLSearchParams(location.search)
    const forceFallback = params.get('fallback') === '1'
    const adapter = await navigator.gpu.requestAdapter(
      forceFallback ? { forceFallbackAdapter: true } : { powerPreference: 'high-performance' },
    )
    if (!adapter) {
      throw new Error(forceFallback ? 'No fallback WebGPU adapter available' : 'No WebGPU adapter available')
    }
    const device = await adapter.requestDevice({
      requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
    })
    device.addEventListener('uncapturederror', (event: GPUUncapturedErrorEvent) => {
      uncapturedErrors.push(event.error.message)
    })
    const format = navigator.gpu.getPreferredCanvasFormat()
    const adapterReport = readAdapterReport(adapter, format)
    const claim1 = await runClaim1(device)
    cleanupClaim2 = await setupClaim2Canvases(device, format)
    const claim3 = await runClaim3(device)
    const willReadFrequentlyFalseMs = await measureUploadLatency(device, false)
    const willReadFrequentlyTrueMs = await measureUploadLatency(device, true)
    const claim4: Claim4Report = {
      adapter: adapterReport,
      willReadFrequentlyFalseMs,
      willReadFrequentlyTrueMs,
    }
    const claim5 = await runClaim5(device)
    const result: ProbeResult = {
      ok: claim1.ok && claim3.ok && claim5.ok && uncapturedErrors.length === 0,
      failure: null,
      userAgent: navigator.userAgent,
      adapter: adapterReport,
      claim1,
      claim2Ready: true,
      claim3,
      claim4,
      claim5,
      uncapturedErrors,
    }
    window.__webgpuProbe = result
    if (outEl) outEl.textContent = JSON.stringify(result, null, 2)
  } catch (error) {
    const result: ProbeResult = {
      ok: false,
      failure: error instanceof Error ? error.message : String(error),
      userAgent: navigator.userAgent,
      adapter: null,
      claim1: null,
      claim2Ready: false,
      claim3: null,
      claim4: null,
      claim5: null,
      uncapturedErrors,
    }
    window.__webgpuProbe = result
    if (outEl) outEl.textContent = JSON.stringify(result, null, 2)
  } finally {
    void cleanupClaim2
  }
}

declare global {
  interface Window {
    __webgpuProbe?: ProbeResult
  }
}

void runProbe()
