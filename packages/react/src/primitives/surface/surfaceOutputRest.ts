// Output rest — the renderer's tone mapping and color space between draws
// while builds started inside one are pending.
//
// The law: three keys a pipeline by the output settings it reads when the
// build runs, after the draw that started it, so the renderer rests in the
// draw's settings until every such build ends. Measured 2026-11-22: without
// it every build came out single-sampled and keyed sRGB, and every first draw
// built its pipeline again with the blocking call (surfaceCompile.ts).
//
// Ownership: this module swaps output settings around draws; the builds are
// surfaceCompileBuild.ts's.

import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'

export interface OutputSettings {
  toneMapping: THREE.ToneMapping
  outputColorSpace: string
}


/**
 * The renderer's output settings while builds started inside a draw run.
 * A render pipeline draws with no tone mapping in the working color space,
 * and three reads those settings when it builds a node, after the draw has
 * put the renderer's own back. So between draws, while builds started in one
 * are pending, the renderer rests in the draw's settings, and each draw runs
 * with its own.
 */
export function createOutputRest(renderer: WebGPURenderer) {
  let own: OutputSettings | null = null
  let pending = 0
  // A write made while the renderer rests is the caller's new setting. A
  // write of the resting value itself cannot be told apart and is lost.
  const wake = () => {
    if (!own) return
    if (renderer.toneMapping !== THREE.NoToneMapping) own.toneMapping = renderer.toneMapping
    if (renderer.outputColorSpace !== THREE.ColorManagement.workingColorSpace) own.outputColorSpace = renderer.outputColorSpace
    renderer.toneMapping = own.toneMapping
    renderer.outputColorSpace = own.outputColorSpace
    own = null
  }
  return {
    started() {
      pending++
    },
    settled() {
      pending--
      if (pending === 0) wake()
    },
    pending: () => pending,
    draw(render: () => void) {
      wake()
      try {
        render()
      } finally {
        if (pending > 0) {
          own = { toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace }
          renderer.toneMapping = THREE.NoToneMapping
          renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace
        }
      }
    },
    dispose: wake,
  }
}
