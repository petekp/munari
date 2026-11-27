import { createRoot } from 'react-dom/client'
import { FisheyeSlice } from './scenes/FisheyeSlice'
import { FlightSlice } from './scenes/FlightSlice'
import { Dpr2SnapSlice, GlassBackdropSlice, OverlapSlice } from './scenes/OverlapDprSlice'
import { createManifestDriver } from './engine/manifest'
import { fisheyeTypeGpuFactory } from './scenes/fisheyeTypegpu'
import { createFlightTypeGpuDriver } from './scenes/flightTypegpu'
import { fisheyeLensManifest } from './materials/fisheye.material.gen'
import { flightCardManifest } from './materials/flight.material.gen'

const params = new URLSearchParams(location.search)
const scene = params.get('scene') ?? 'flight'
const mode = params.get('material') ?? 'wgsl'

function getFlightDriver() {
  return mode === 'typegpu' ? createFlightTypeGpuDriver() : createManifestDriver(flightCardManifest)
}

function getFisheyeFactory() {
  if (mode === 'typegpu') return fisheyeTypeGpuFactory
  if (mode === 'manifest') return createManifestDriver(fisheyeLensManifest).factory
  return undefined
}

const root = createRoot(document.getElementById('root')!)

function renderScene() {
  if (scene === 'fisheye') return <FisheyeSlice materialFactory={getFisheyeFactory()} />
  if (scene === 'overlap') return <OverlapSlice />
  if (scene === 'dpr2') return <Dpr2SnapSlice />
  if (scene === 'glass-backdrop') return <GlassBackdropSlice />
  return <FlightSlice createTypeGpuDriver={mode === 'wgsl' ? undefined : getFlightDriver} />
}

root.render(renderScene())
