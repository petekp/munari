import { describe, expect, it } from 'vitest'
import { tokenize } from './candidateTokens'

const SOURCE = `const surface = useSurface({ name: 'card' })
<Surface.DOM>{card}</Surface.DOM>`

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
    expect(tags).toEqual(['<Surface.DOM', '>', '</Surface.DOM', '>'])
  })

  it('reads a prop written with a brace as an attribute', () => {
    expect(tokenize('<S view={v}>')).toContainEqual({ kind: 'attr', text: 'view' })
  })
})
