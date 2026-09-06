# Postcard preview

`postcard.mp4` is a recording of the overview's live postcard, captured on
2026-09-04 in Chrome with `--enable-features=CanvasDrawElement`. It contains
no audio and is labelled as a recording on browsers without the capability.

To replace it, open `/?scene=home&framed` at 1280×720. Type a name, choose
**Show in 3D**, add a stamp and continue typing on the mesh, then choose
**Return to page**. Record the real interaction, including both handoffs.
Keep the card's full motion inside the crop.

The current recording is 8.52 seconds at 25 fps, with the first 0.6 seconds
of page loading removed. Its crop is 530×342 at (746, 110). `postcard.jpg`
is the first frame, used while the video loads.

Encode H.264 with `yuv420p`, CRF 20, and `+faststart` for native
browser playback. Recheck these bounds if the overview layout changes.
