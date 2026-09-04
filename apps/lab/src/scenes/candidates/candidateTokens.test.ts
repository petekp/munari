import { describe, expect, it } from 'vitest'
import { tokenize } from './candidateTokens'

const SOURCE = `const surface = useSurfaceHandle('card')
<Surface renderIn="both" source={card}>
  <Surface.DOM />
  <Surface.Mesh />
</Surface>`

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
    expect(tags).toEqual(['<Surface', '>', '<Surface.DOM', '/>', '<Surface.Mesh', '/>', '</Surface', '>'])
  })

  it('reads a prop written with a brace as an attribute', () => {
    expect(tokenize('<S renderIn={v}>')).toContainEqual({ kind: 'attr', text: 'renderIn' })
  })
})
