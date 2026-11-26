// Font encoding — a face's bytes as a data URL, fetched once per URL.
//
// Ownership: snapdomFonts.ts decides which faces a capture carries; this module
// only turns one face URL into embeddable bytes and remembers the outcome.

export interface EncodedFace {
  readonly data: string
  readonly format: string
}

function detectFontFormat(contentType: string | null, url: string) {
  const type = (contentType ?? '').toLowerCase()
  if (type.includes('woff2')) return { mime: 'font/woff2', format: 'woff2' }
  if (type.includes('woff')) return { mime: 'font/woff', format: 'woff' }
  if (type.includes('ttf') || type.includes('truetype')) return { mime: 'font/ttf', format: 'truetype' }
  if (type.includes('otf') || type.includes('opentype')) return { mime: 'font/otf', format: 'opentype' }
  let path = url.toLowerCase()
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    // Non-URL falls back to suffix check.
  }
  if (path.endsWith('.woff')) return { mime: 'font/woff', format: 'woff' }
  if (path.endsWith('.ttf')) return { mime: 'font/ttf', format: 'truetype' }
  if (path.endsWith('.otf')) return { mime: 'font/otf', format: 'opentype' }
  return { mime: 'font/woff2', format: 'woff2' }
}

// Cache the in-flight promise so overlapping captures share one request. A
// definitive failure (a 4xx other than 408 or 429) stays cached, so a broken
// font URL costs one request, not one per capture. A thrown fetch, a 5xx, 408
// or 429 is transient: the first three are evicted so an outage does not poison
// the face for the page, and later ones stay cached for a backoff. A face that
// never loads, such as a cross-origin one without CORS headers, then costs one
// request per backoff, not one per capture. These are the stylesheet path's
// limits in snapdomFonts.ts (`sheetFaces`).
const IMMEDIATE_RETRIES = 3
const RETRY_BACKOFF_MS = 5_000

interface CachedFace {
  readonly pending: Promise<EncodedFace | null>
  retryAt?: number
}

const encodedByUrl = new Map<string, CachedFace>()
const transientFailuresByUrl = new Map<string, number>()

function isTransientFontStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

export function encodeFace(url: string): Promise<EncodedFace | null> {
  const cached = encodedByUrl.get(url)
  if (cached && (cached.retryAt === undefined || performance.now() < cached.retryAt)) return cached.pending
  let transientFailure = false
  const pending = (async (): Promise<EncodedFace | null> => {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        transientFailure = isTransientFontStatus(response.status)
        return null
      }
      const { mime, format } = detectFontFormat(response.headers.get('content-type'), url)
      const bytes = new Uint8Array(await response.arrayBuffer())
      // Chunked: `String.fromCharCode(...bytes)` overflows around 100 KB.
      let binary = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
      }
      return { data: `data:${mime};base64,${btoa(binary)}`, format }
    } catch {
      transientFailure = true
      return null
    }
  })().then((result) => {
    if (result) {
      transientFailuresByUrl.delete(url)
      return result
    }
    if (!transientFailure) return result
    const failures = (transientFailuresByUrl.get(url) ?? 0) + 1
    transientFailuresByUrl.set(url, failures)
    if (failures <= IMMEDIATE_RETRIES) {
      if (encodedByUrl.get(url) === entry) encodedByUrl.delete(url)
    } else {
      entry.retryAt = performance.now() + RETRY_BACKOFF_MS
    }
    return result
  })
  const entry: CachedFace = { pending }
  encodedByUrl.set(url, entry)
  return pending
}
