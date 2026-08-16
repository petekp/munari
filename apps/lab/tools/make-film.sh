#!/bin/bash
# make-film — the source of apps/lab/src/scenes/genie/film.mp4
#
# The lab needs a window whose content is DECODED VIDEO rather than
# markup, because that is the strongest claim this scene can make: the
# texture is a live replay of the page's paint records, and video frames
# are the one kind of content you would expect that replay to miss.
# (They do arrive — measured 2026-08-09, Chrome 150.)
#
# The clip this replaces was GENERATED — a gradient sky, built by a
# script rather than sourced — and the reason it gave in its own header
# was a good one: a stock file is "a binary in the tree with no
# provenance, no licence story, and no way to change its size, palette,
# or length without finding another one." That
# objection is still correct, and this script is the answer to it rather
# than a dismissal of it. Every number below is a parameter, so the size,
# palette, and length remain changeable; the provenance and the licence
# question live in film.provenance.md beside the output. What the
# generated clip could not supply is the subject: an abstract gradient is
# unmistakably synthetic, and a viewer who suspects the window is a
# texture rather than a video has no way to be talked out of it. A man
# turning a disc is not a thing anyone believes a shader made.
#
# The source is NOT in the repo — it is a couple of minutes of 480p and
# 165 MB. Pass its path:
#
#   apps/lab/tools/make-film.sh ~/Downloads/munari.mov
#
set -euo pipefail
SRC="${1:?usage: make-film.sh <source-video> [outdir]}"
OUT="${2:-$(cd "$(dirname "$0")/../src/scenes/genie" && pwd)}"

# ── the take ──────────────────────────────────────────────────────────
#
# One static-camera shot, Munari spinning a colour disc, running 47s–64s
# in the source. Static matters twice over: it is what lets the wrap
# below be a dissolve rather than a cut, and it is what keeps the window
# legible after the genie has folded it to the width of a dock bay.
IN=49.0
LEN=12.0   # must equal FILM_PERIOD in Genie.tsx
FADE=0.5

# ── framing ───────────────────────────────────────────────────────────
#
# The crop does two jobs. It removes the tape's dead edges (cropdetect
# finds 4px of black down the left, and the bottom rows carry the same),
# and it sets the aspect to the window's own — 300x198 CSS, encoded at 2x
# — so `object-fit: cover` crops nothing at rest and every shipped pixel
# is a pixel that gets displayed. The vertical offset is biased upward of
# centre: a centred crop puts the disc within a dozen rows of the top
# edge, and the disc is the subject.
#
# 25fps, not 30 and not the container's 60. The source is a PAL transfer
# padded up to 60 — mpdecimate finds 251 unique frames in 10 seconds — so
# 25 is the true cadence and anything else re-samples a cadence that is
# already whole. hqdn3d before quantisation, because tape grain dithered
# to 256 colours is grain the encoder then has to spend bits on twice.
PRE="[0:v]crop=628:414:6:18,scale=600:396:flags=lanczos,fps=25,hqdn3d=2:1.5:3:3"

# ── the wrap ──────────────────────────────────────────────────────────
#
# The window loops forever on a desk that invites you to stare at it, and
# documentary footage does not loop. Cutting from the last frame back to
# the first is a jump cut — the same shot, the arm somewhere else — which
# reads as a fault rather than as an edit; a search over the take put the
# best available hard cut at roughly two and a half times the frame-to-
# frame change of ordinary playback.
#
# So take LEN+FADE and lay the trailing FADE over the leading FADE. The
# clip's last frame and its first are then CONSECUTIVE frames of the take
# — continuity by construction, not by luck — and the seam is a half-
# second dissolve, which is the grammar the source itself cuts in.
END=$(echo "$LEN + $FADE" | bc)
LOOP="split=3[a][b][c];\
[a]trim=0:${FADE},setpts=PTS-STARTPTS,fps=25[head];\
[b]trim=${LEN}:${END},setpts=PTS-STARTPTS,fps=25[tail];\
[c]trim=${FADE}:${LEN},setpts=PTS-STARTPTS,fps=25[rest];\
[tail][head]xfade=transition=fade:duration=${FADE}:offset=0[mix];\
[mix][rest]concat=n=2:v=1:a=0"

# ── the palette ───────────────────────────────────────────────────────
#
# 256 colours with an ordered dither, which is what a movie looked like
# on the desktop this scene is quoting. The dither is ORDERED (bayer) and
# not error-diffused on purpose: a Floyd-Steinberg pattern is re-derived
# every frame and so is pure noise to an inter-frame codec, while a Bayer
# matrix is fixed in place and mostly survives as a static overlay. It
# still is not free — it costs about 40% over the undithered encode, 758
# KB against 537 — and that is the whole price of the look, paid once, in
# a lab asset that is never published.
PALETTE="[q];[q]split[s1][s2];\
[s1]palettegen=max_colors=256:stats_mode=full[p];\
[s2][p]paletteuse=dither=bayer:bayer_scale=2,format=yuv420p[v]"

# ── the encode ────────────────────────────────────────────────────────
#
# -an because the window has no sound and a muted track is bytes that
# ship to every visitor to be discarded. The dense keyframe interval is
# deliberate and is not about seek accuracy, which browsers give you
# regardless: both copies of this window seek to `now mod duration` at
# mount, and a seek served from a distant keyframe is a seek that lands
# late. That latency is charged to the clip's position and never paid
# back — see the 69ms disagreement recorded in Genie.tsx. One keyframe
# per second costs a few percent and bounds it.
ffmpeg -v error -y -ss "$IN" -i "$SRC" -t "$END" \
  -filter_complex "${PRE},${LOOP}${PALETTE}" -map '[v]' \
  -an -c:v libx264 -preset veryslow -crf 26 -profile:v high -level 4.0 \
  -g 25 -keyint_min 25 -sc_threshold 0 -pix_fmt yuv420p -movflags +faststart \
  "$OUT/film.mp4"

printf 'film.mp4  %s bytes  ' "$(stat -f%z "$OUT/film.mp4")"
ffprobe -v error -show_entries stream=width,height,nb_frames \
  -show_entries format=duration -of csv=p=0 "$OUT/film.mp4" | tr '\n' ' '
echo
