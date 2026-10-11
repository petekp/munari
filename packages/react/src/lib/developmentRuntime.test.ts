import { describe, expect, it } from 'vitest'
import { resolveDevelopment } from './developmentRuntime'

describe('resolveDevelopment', () => {
  it('lets an explicit Vite flag decide, else treats development and test NODE_ENV as development', () => {
    expect(resolveDevelopment(false, 'development')).toBe(false)
    expect(resolveDevelopment(undefined, 'production')).toBe(false)
    expect(resolveDevelopment(undefined, undefined)).toBe(false)
    expect(resolveDevelopment(true, 'production')).toBe(true)
    expect(resolveDevelopment(undefined, 'test')).toBe(true)
    expect(resolveDevelopment(undefined, 'development')).toBe(true)
  })
})
