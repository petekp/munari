// Optional WebGPU timestamp-query timer — measures render-pass duration across
// pass 1 + optional backdrop blur/pass 2 via async double-buffered `mapAsync`
// readback so timing probes never stall a frame (`decisions.md #80`).
//
// Ownership: `@petepetrash/munari/gpu`.

export interface GpuTimestampTimer {
  pass1Writes(singlePass: boolean): GPURenderPassTimestampWrites | undefined
  pass2Writes(): GPURenderPassTimestampWrites | undefined
  resolve(encoder: GPUCommandEncoder): void
  readAfterSubmit(): void
  lastMs(): number | null
  dispose(): void
}

const TIMESTAMP_BUF_USAGE = 0x0001 | 0x0008 // MAP_READ | COPY_DST
const QUERY_RESOLVE_USAGE = 0x0200 | 0x0004 // QUERY_RESOLVE | COPY_SRC

/** Creates an optional non-blocking 2-slot timestamp-query timer for GPU pass duration. */
export function createGpuTimestampTimer(device: GPUDevice, enabled: boolean): GpuTimestampTimer {
  if (!enabled) {
    return {
      pass1Writes: () => undefined,
      pass2Writes: () => undefined,
      resolve() {},
      readAfterSubmit() {},
      lastMs: () => null,
      dispose() {},
    }
  }
  const querySet = device.createQuerySet({ type: 'timestamp', count: 2 })
  const resolveBuf = device.createBuffer({ size: 16, usage: QUERY_RESOLVE_USAGE })
  const readBufs = [
    device.createBuffer({ size: 16, usage: TIMESTAMP_BUF_USAGE }),
    device.createBuffer({ size: 16, usage: TIMESTAMP_BUF_USAGE }),
  ] as const
  let activeSlot = 0
  let submittedSlot = -1
  let lastDurationMs: number | null = null
  let disposed = false

  return {
    pass1Writes: (singlePass) =>
      singlePass
        ? { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 }
        : { querySet, beginningOfPassWriteIndex: 0 },
    pass2Writes: () => ({ querySet, endOfPassWriteIndex: 1 }),
    resolve(encoder) {
      const target = readBufs[activeSlot]!
      if (target.mapState !== 'unmapped') {
        submittedSlot = -1
        return
      }
      encoder.resolveQuerySet(querySet, 0, 2, resolveBuf, 0)
      encoder.copyBufferToBuffer(resolveBuf, 0, target, 0, 16)
      submittedSlot = activeSlot
      activeSlot = 1 - activeSlot
    },
    readAfterSubmit() {
      if (disposed || submittedSlot < 0) return
      const buf = readBufs[submittedSlot]!
      submittedSlot = -1
      if (buf.mapState !== 'unmapped') return
      void buf.mapAsync(0x0001).then(
        () => {
          if (!disposed) {
            const view = new BigUint64Array(buf.getMappedRange())
            const diffNs = Number(view[1]! - view[0]!)
            if (Number.isFinite(diffNs) && diffNs >= 0 && diffNs < 1e9) {
              lastDurationMs = diffNs / 1e6
            }
          }
          if (buf.mapState === 'mapped') buf.unmap()
        },
        () => {},
      )
    },
    lastMs: () => lastDurationMs,
    dispose() {
      disposed = true
      querySet.destroy()
      resolveBuf.destroy()
      readBufs[0].destroy()
      readBufs[1].destroy()
    },
  }
}
