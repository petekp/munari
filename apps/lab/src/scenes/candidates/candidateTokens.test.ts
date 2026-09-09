import { describe, expect, it } from 'vitest'
import { tokenize } from './candidateTokens'

const SOURCE = `const surface = useSurfaceHandle('card')
<Surface.Root surface={surface} inScene={selected}>
  <Surface.HTML><Card /></Surface.HTML>
  <Surface.Scene><Surface.Mesh /></Surface.Scene>
</Surface.Root>`

describe('tokenize', () => {
  it('loses nothing', () => {
    expect(tokenize(SOURCE).map((t) => t.text).join('')).toBe(SOURCE)
  })

  it('reads a string as one span, quotes included', () => {
    expect(tokenize(SOURCE)).toContainEqual({ kind: 'string', text: "'card'" })
  })

  it('does not find keywords inside a string', () => {
    expect(tokenize("'const let'")).toEqual([{ kind: 'string', text: "'const let'" }])
  })

  it('reads both halves of a JSX element as tags', () => {
    const tags = tokenize(SOURCE).filter((t) => t.kind === 'tag').map((t) => t.text)
    expect(tags).toEqual(['<Surface.Root', '>', '<Surface.HTML', '>', '<Card', '/>', '</Surface.HTML', '>', '<Surface.Scene', '>', '<Surface.Mesh', '/>', '</Surface.Scene', '>', '</Surface.Root', '>'])
  })

  it('reads a prop written with a brace as an attribute', () => {
    expect(tokenize('<Surface inScene={selected}>')).toContainEqual({ kind: 'attr', text: 'inScene' })
  })
})
