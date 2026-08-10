# film.mp4 — where it came from

The clip in the triangolo window. It replaced a generated one
(`tools/make-sky.mjs`), and the trade it made was provenance for
subject: a gradient can be regenerated from a seed and explains itself,
but nobody looking at it can tell a video from a shader. This file
cannot explain itself, so this is where it is explained.

## The output

| | |
|---|---|
| dimensions | 600 × 396 — the window's body box (300 × 198 CSS) at 2× |
| duration | 12.000s exactly, 300 frames at 25fps |
| colour | 256, ordered (Bayer) dither |
| audio | none — the source has no audio stream, and `-an` keeps it that way |
| size | 757,694 bytes |

## The source

A documentary on Bruno Munari, supplied as `munari.mov`: 165 MB, H.264,
640 × 484, progressive, 271.8s, no audio. A PAL transfer padded to 60fps
— `mpdecimate` finds 251 unique frames in 10 seconds, so the real
cadence is 25.

Used: **49.0s to 61.5s**, inside a single static-camera take that runs
roughly 47–64s. Munari spinning a colour disc.

The source file is not in the repo and does not need to be for the build
— `film.mp4` is committed. It is needed only to run the script below.

## Reproducing it

```sh
apps/lab/tools/make-film.sh path/to/munari.mov
```

Byte-identical to the committed file. Every parameter — in-point,
length, crop, palette, quality — is named at the top of that script,
with the reasoning for each.

## Licence

**Unresolved.** The source was supplied without licence terms, and the
footage is a third-party documentary rather than anything openly
licensed. `apps/lab` is deployed publicly, so this needs an answer
before the demo goes anywhere it can be found: either the rights, or a
replacement from a source with documented terms (Pexels, Coverr and
Pixabay all permit commercial use without attribution; Wikimedia Commons
and the Internet Archive carry per-item terms worth reading).

Nothing else in the tree depends on the footage's *content* — swapping
in different material is one run of the script with a different in-point.
