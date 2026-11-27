// One timing sample of one softbox table source: import, decode, upload.
// The page reads ?method=three|half64|half32 and leaves its numbers on
// window.softboxTiming. Upload is the two textures RectAreaLightNode samples
// on this device, through three's initTexture, finished when the GPU queue
// reports its submitted work done.

import { WebGPURenderer } from 'three/webgpu'
import { decodeSoftboxTables } from '../../../packages/react/src/primitives/surface/softboxTables.ts'

const method = new URLSearchParams(location.search).get('method')

async function run() {
  const renderer = new WebGPURenderer()
  await renderer.init()
  const float = renderer.hasFeature('float32-filterable')
  const start = performance.now()
  const module =
    method === 'three'
      ? await import('three/examples/jsm/lights/RectAreaLightTexturesLib.js')
      : method === 'half64'
        ? await import('../../../packages/react/src/primitives/surface/ltc/ltc64Half.ts')
        : await import('../../../packages/react/src/primitives/surface/ltc/ltc32Half.ts')
  const imported = performance.now()
  const tables = method === 'three' ? module.RectAreaLightTexturesLib.init() : decodeSoftboxTables(module.default, method === 'half64' ? 64 : 32)
  const decoded = performance.now()
  const used = float ? [tables.LTC_FLOAT_1, tables.LTC_FLOAT_2] : [tables.LTC_HALF_1, tables.LTC_HALF_2]
  for (const texture of used) renderer.initTexture(texture)
  await renderer.backend.device.queue.onSubmittedWorkDone()
  const uploaded = performance.now()
  return { method, float, importMs: imported - start, decodeMs: decoded - imported, uploadMs: uploaded - decoded, totalMs: uploaded - start }
}

window.softboxTiming = run().catch((error) => ({ error: String(error) }))
