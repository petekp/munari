import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { FisheyeSlice } from '../scenes/FisheyeSlice'
import { createManifestDriver } from '../engine/manifest'
import { fisheyeLensManifest } from '../materials/fisheye.material.gen'

const fisheyeFactory = createManifestDriver(fisheyeLensManifest).factory

createRoot(document.getElementById('root')!).render(
  createElement(FisheyeSlice, { materialFactory: fisheyeFactory }),
)
