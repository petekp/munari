import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { FisheyeSlice } from '../scenes/FisheyeSlice'

createRoot(document.getElementById('root')!).render(createElement(FisheyeSlice))
