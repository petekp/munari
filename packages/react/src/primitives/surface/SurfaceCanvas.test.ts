// A frameloop request that changes nothing must not reach R3F: its setter
// restarts the shared clock on every call, and the host asks twice per capture.
import { expect, it } from 'vitest'
import { settleFrameloop } from './SurfaceCanvas'

it('asks R3F for a frameloop mode only when the mode changes', () => {
  const calls: string[] = []
  const state = { frameloop: 'demand' as const, setFrameloop: (mode: 'always' | 'demand' | 'never' = 'always') => { calls.push(mode) } }
  settleFrameloop(state, 'demand')
  settleFrameloop(state, 'demand')
  expect(calls).toEqual([])
  settleFrameloop(state, 'always')
  expect(calls).toEqual(['always'])
})
