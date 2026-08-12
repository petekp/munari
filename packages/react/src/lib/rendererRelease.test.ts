import { describe, expect, it, vi } from 'vitest'

import { commitRendererReleaseFrame } from './rendererRelease'

describe('commitRendererReleaseFrame', () => {
  it('hands visual ownership over before suppressing the renderer', async () => {
    const outgoing = { visible: true }
    const order: string[] = []

    commitRendererReleaseFrame({
      outgoing,
      commitIncoming: () => {
        expect(outgoing.visible).toBe(true)
        order.push('incoming')
      },
      publishRelease: () => {
        expect(outgoing.visible).toBe(false)
        order.push('published')
      },
    })

    expect(outgoing.visible).toBe(false)
    expect(order).toEqual(['incoming'])

    await Promise.resolve()
    expect(order).toEqual(['incoming', 'published'])
  })

  it('keeps the outgoing presenter if the incoming commit fails', async () => {
    const outgoing = { visible: true }
    const publishRelease = vi.fn()

    expect(() =>
      commitRendererReleaseFrame({
        outgoing,
        commitIncoming: () => {
          throw new Error('incoming presenter unavailable')
        },
        publishRelease,
      }),
    ).toThrow('incoming presenter unavailable')

    expect(outgoing.visible).toBe(true)
    await Promise.resolve()
    expect(publishRelease).not.toHaveBeenCalled()
  })
})
