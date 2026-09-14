// A frameloop request that changes nothing must not reach R3F: its setter
// restarts the shared clock on every call, and the host asks twice per capture.
import { expect, it } from 'vitest'
import type { RootState } from '@react-three/fiber'
import { settleFrameloop } from './SurfaceCanvas'

type FrameClock = Pick<RootState, 'frameloop' | 'setFrameloop'> & { elapsedTime: number }

it('asks R3F for a frameloop mode only when the mode changes', () => {
  const state: FrameClock = {
    frameloop: 'demand',
    elapsedTime: 120,
    setFrameloop(mode: 'always' | 'demand' | 'never' = 'always') {
      state.frameloop = mode
      state.elapsedTime = 0
    },
  }
  settleFrameloop(state, 'demand')
  settleFrameloop(state, 'demand')
  expect(state.elapsedTime).toBe(120)
  settleFrameloop(state, 'always')
  expect(state.frameloop).toBe('always')
  state.elapsedTime = 75
  settleFrameloop(state, 'always')
  expect(state.elapsedTime).toBe(75)
  settleFrameloop(state, 'demand')
  expect(state.frameloop).toBe('demand')
})
