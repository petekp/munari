# Next.js and server rendering

The `@petepetrash/munari` and `@petepetrash/munari/advanced` entries start with
`'use client'`. A Next.js server component can import `Surface`, `SurfaceCanvas`
and the hooks. `Surface` and `SurfaceCanvas` render on the client only. A
component that calls a hook still needs its own `'use client'`, and `Surface`
needs an `inScene` boolean prop.

`useSurfaceSupport()` is `false` on the server and on the first client render,
then reports the browser. Gate the canvas on it, as the first example does, and
the server and client markup match.

`@petepetrash/munari/snapdom` has no directive. Call `enableSnapdomCapture()` at
the top level of a client module that loads before the first `Surface` mounts.
The call is safe during server render:

```tsx
'use client'
import { enableSnapdomCapture } from '@petepetrash/munari/snapdom'
import { Example } from './Example'

enableSnapdomCapture()

export function ExampleWithSnapdom() {
  return <Example />
}
```
