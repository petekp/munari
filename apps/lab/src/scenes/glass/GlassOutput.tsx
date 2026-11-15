// Glass output — the lab presenter admits only uploaded panel ink.
import { useThree } from '@react-three/fiber'
import type { Texture } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { drawSurfaceOutput, readSurfaceFrame, uploadSurfaceFrame } from '../../lib/surfaceFrames'
import { GlassSdfCompositor } from './glassSdf'

export function GlassOutput() {
  const renderer = useThree(state => state.gl)
  const frameOutput = {
    read(texture: Texture) {
      const frame = readSurfaceFrame(texture)
      return frame && renderer instanceof WebGPURenderer && uploadSurfaceFrame(frame, renderer) ? frame : null
    },
    draw: drawSurfaceOutput,
  }
  return <GlassSdfCompositor frameOutput={frameOutput} />
}
