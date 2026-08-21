// A four-colour scanner for the one snippet the copy candidate shows.
//
// Not a syntax highlighter in any general sense, and deliberately not a
// dependency: the copy effect needs colour in the block so that a cloud of
// it flying into the cursor is legible as CODE rather than as grey text,
// and colour is the only thing being asked for. A real tokenizer would be
// several hundred lines of behaviour nothing in this scene tests.
//
// Ownership: this module turns a string into a flat list of spans. It has
// no opinion about what colour any kind is — that is the stylesheet's.

export type TokenKind = 'keyword' | 'string' | 'tag' | 'attr' | 'call' | 'plain'

export interface Token {
  kind: TokenKind
  text: string
}

// Ordered: the first alternative that matches at a position wins, so
// strings come before everything that could occur inside one.
const SCAN =
  /('[^']*')|(\b(?:const|let|return|import|export|from)\b)|(<\/?[A-Z][\w.]*|\/?>)|(\b[a-z][\w]*(?==\{))|(\b[a-z]\w*(?=\())/g

const KIND: readonly TokenKind[] = ['string', 'keyword', 'tag', 'attr', 'call']

/** Split `source` into spans. Concatenating every `text` gives it back. */
export function tokenize(source: string): Token[] {
  const out: Token[] = []
  let last = 0
  SCAN.lastIndex = 0
  for (let m = SCAN.exec(source); m !== null; m = SCAN.exec(source)) {
    if (m.index > last) out.push({ kind: 'plain', text: source.slice(last, m.index) })
    // Exactly one capture group is set, and its position is the kind.
    const group = KIND.findIndex((_, i) => m[i + 1] !== undefined)
    out.push({ kind: KIND[group] ?? 'plain', text: m[0] })
    last = m.index + m[0].length
  }
  if (last < source.length) out.push({ kind: 'plain', text: source.slice(last) })
  return out
}
