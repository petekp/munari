import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { FlightSlice } from '../scenes/FlightSlice'
import { createFlightTypeGpuDriver } from '../scenes/flightTypegpu'

createRoot(document.getElementById('root')!).render(
  createElement(FlightSlice, { createTypeGpuDriver: createFlightTypeGpuDriver }),
)
