// Whether the lab shows its own furniture.
//
// Every scene here is wrapped in things that belong to the LAB rather
// than to the work: the scene chips, the munari masthead and its
// capability lamps, the caption under each demo, and the tuning panels.
// All of it earns its place while a scene is being built, and all of it
// is noise the moment the scene is the subject — a screenshot, a
// recording, a demo standing on its own.
//
// `?bare` strips it. The param is read once, at module load: the URL is
// already authoritative for which scene opens (App.tsx), a reader cannot
// change it without a reload, and a constant keeps this out of every
// render path that consults it.
//
// What `?bare` must NEVER hide is anything the page needs to be honest —
// the unsupported-browser screen above all. Chrome is what the lab says
// about itself; that screen is what the browser says about the browser.

/** True when the URL asks for the scene alone, with no lab furniture. */
export const BARE = new URLSearchParams(window.location.search).has('bare')

/** True when this window is the shell's scene frame: the scene keeps its
 *  own furniture (tuning panels, capability notice) but the shell across
 *  the frame boundary owns the nav and masthead. Without the param the
 *  frame would render the shell again, recursively. */
export const FRAMED = new URLSearchParams(window.location.search).has('framed')

/** True when the lab may draw its own chrome — the common spelling at
 *  the call sites, so a reader sees `showChrome && <Panel/>` rather than
 *  a negation to unpick. */
export const showChrome = !BARE

/** True when this window should render the nav shell around a framed
 *  scene rather than a scene itself. */
export const showShell = !BARE && !FRAMED
