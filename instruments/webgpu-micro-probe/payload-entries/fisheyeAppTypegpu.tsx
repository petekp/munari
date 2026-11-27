import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { FisheyeSlice } from '../scenes/FisheyeSlice'
import { fisheyeTypeGpuFactory } from '../scenes/fisheyeTypegpu'

createRoot(document.getElementById('root')!).render(
  createElement(FisheyeSlice, { materialFactory: fisheyeTypeGpuFactory }),
)
