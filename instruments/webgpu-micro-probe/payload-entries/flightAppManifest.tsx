import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { FlightSlice } from '../scenes/FlightSlice'
import { createManifestDriver } from '../engine/manifest'
import { flightCardManifest } from '../materials/flight.material.gen'

const createDriver = () => createManifestDriver(flightCardManifest)

createRoot(document.getElementById('root')!).render(
  createElement(FlightSlice, { createTypeGpuDriver: createDriver }),
)
